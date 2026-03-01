#!/usr/bin/env bash
# deploy.sh — Docker Swarm 一键部署脚本
# 用法：
#   初始化集群 + 部署:  ./deploy.sh init
#   仅部署/更新 Stack:  ./deploy.sh deploy
#   构建并推送镜像:     ./deploy.sh build
#   查看状态:           ./deploy.sh status
#   销毁 Stack:         ./deploy.sh destroy

set -euo pipefail

# ── 颜色输出 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ── 配置 ──
STACK_NAME="ecom"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 镜像 Registry（部署前必须设置）
: "${REGISTRY:=registry.example.com/ecom}"
: "${TAG:=latest}"

# 服务列表
SERVICES=(api-gateway user-service product-service cart-service order-service)

# ══════════════════════════════════════════════════
# 函数定义
# ══════════════════════════════════════════════════

check_docker() {
  if ! command -v docker &>/dev/null; then
    log_error "Docker 未安装"
    exit 1
  fi
  log_ok "Docker 已安装: $(docker --version)"
}

# 初始化 Swarm 集群
init_swarm() {
  log_info "═══ 初始化 Docker Swarm 集群 ═══"

  # 检查是否已经是 Swarm 模式
  if docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "active"; then
    log_warn "当前节点已在 Swarm 模式中"
  else
    log_info "初始化 Swarm Manager..."
    # 使用当前节点的 IP 初始化（生产中需指定 --advertise-addr）
    docker swarm init --advertise-addr "${MANAGER_IP:-$(hostname -I | awk '{print $1}')}" || {
      log_error "Swarm 初始化失败，请检查网络配置"
      exit 1
    }
    log_ok "Swarm Manager 初始化成功"
  fi

  echo ""
  log_info "═══ 加入集群的 Token ═══"
  echo ""
  log_info "Manager 节点加入命令（S2, S3 执行）："
  docker swarm join-token manager 2>/dev/null || true
  echo ""
  log_info "Worker 节点加入命令（S4, S5 执行）："
  docker swarm join-token worker 2>/dev/null || true
  echo ""
  log_warn "请先让所有节点加入集群，再执行: $0 labels"
}

# 设置节点标签
set_labels() {
  log_info "═══ 设置节点标签 ═══"
  echo ""
  log_info "当前集群节点："
  docker node ls
  echo ""

  # 获取节点列表
  local nodes
  nodes=$(docker node ls --format '{{.Hostname}}' 2>/dev/null)

  if [ -z "$nodes" ]; then
    log_error "未找到集群节点"
    exit 1
  fi

  echo "请为每个节点分配角色："
  echo "  db-1     — S1: PG 数据节点 + Redis 主 + etcd（数据层）"
  echo "  db-2     — S2: PG 数据节点 + Redis 从 + etcd（数据层）"
  echo "  gateway  — S3: Caddy 反向代理 + etcd（入口层）"
  echo "  (Worker 节点 S4/S5 无需标签，仅需 worker 角色)"
  echo ""

  # 交互式设置标签
  for node in $nodes; do
    read -rp "节点 ${node} 的角色 [db-1/db-2/gateway/skip]: " role
    case "$role" in
      db-1)
        docker node update --label-add role=db-1 "$node"
        log_ok "$node → db-1"
        ;;
      db-2)
        docker node update --label-add role=db-2 "$node"
        log_ok "$node → db-2"
        ;;
      gateway)
        docker node update --label-add role=gateway "$node"
        log_ok "$node → gateway"
        ;;
      skip|"")
        log_info "$node → 跳过（Worker 节点无需标签）"
        ;;
      *)
        log_warn "$node → 未知角色 '$role'，跳过"
        ;;
    esac
  done

  echo ""
  log_info "当前节点标签："
  docker node ls -q | while read -r nid; do
    local hostname labels
    hostname=$(docker node inspect --format '{{.Description.Hostname}}' "$nid")
    labels=$(docker node inspect --format '{{range $k,$v := .Spec.Labels}}{{$k}}={{$v}} {{end}}' "$nid")
    echo "  $hostname: ${labels:-（无标签）}"
  done
}

# 创建 Docker Secrets
create_secrets() {
  log_info "═══ 创建 Docker Secrets ═══"

  local secrets=(postgres_password replication_password jwt_access_secret jwt_refresh_secret internal_secret)

  for secret in "${secrets[@]}"; do
    if docker secret inspect "$secret" &>/dev/null; then
      log_warn "Secret '$secret' 已存在，跳过（如需更新请先删除: docker secret rm $secret）"
    else
      read -rsp "请输入 ${secret} 的值: " value
      echo ""
      if [ -z "$value" ]; then
        log_error "Secret 值不能为空"
        exit 1
      fi

      # 密钥长度校验
      local min_len=8
      case "$secret" in
        jwt_access_secret|jwt_refresh_secret) min_len=16 ;;
        internal_secret|replication_password) min_len=8 ;;
      esac

      if [ ${#value} -lt $min_len ]; then
        log_error "$secret 长度不能少于 $min_len 字符"
        exit 1
      fi

      echo -n "$value" | docker secret create "$secret" -
      log_ok "Secret '$secret' 创建成功"
    fi
  done

  echo ""
  log_ok "所有 Secrets 就绪"
}

# 构建并推送镜像
build_images() {
  log_info "═══ 构建并推送镜像 ═══"
  log_info "Registry: $REGISTRY"
  log_info "Tag: $TAG"
  echo ""

  cd "$REPO_ROOT"

  for service in "${SERVICES[@]}"; do
    local image_name="${REGISTRY}/ecom-${service}:${TAG}"

    # 根据服务确定 Dockerfile 路径
    local dockerfile
    if [ "$service" = "api-gateway" ]; then
      dockerfile="apps/api-gateway/Dockerfile"
    else
      dockerfile="services/${service}/Dockerfile"
    fi

    log_info "构建 $service → $image_name"
    docker build -t "$image_name" -f "$dockerfile" . || {
      log_error "构建 $service 失败"
      exit 1
    }

    log_info "推送 $image_name"
    docker push "$image_name" || {
      log_error "推送 $service 失败，请确认已登录 Registry: docker login $REGISTRY"
      exit 1
    }

    log_ok "$service 构建并推送成功"
  done

  echo ""
  log_ok "所有镜像构建并推送完成"
}

# 部署 Stack
deploy_stack() {
  log_info "═══ 部署 Stack: $STACK_NAME ═══"

  # 检查 Swarm 模式
  if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "active"; then
    log_error "当前节点不在 Swarm 模式中，请先执行: $0 init"
    exit 1
  fi

  # 检查 Secrets 是否存在
  local secrets=(postgres_password replication_password jwt_access_secret jwt_refresh_secret internal_secret)
  for secret in "${secrets[@]}"; do
    if ! docker secret inspect "$secret" &>/dev/null; then
      log_error "Secret '$secret' 不存在，请先执行: $0 secrets"
      exit 1
    fi
  done

  # 检查节点标签
  local has_db1 has_db2 has_gateway
  has_db1=$(docker node ls -q | xargs -I{} docker node inspect --format '{{index .Spec.Labels "role"}}' {} 2>/dev/null | grep -c "db-1" || true)
  has_db2=$(docker node ls -q | xargs -I{} docker node inspect --format '{{index .Spec.Labels "role"}}' {} 2>/dev/null | grep -c "db-2" || true)
  has_gateway=$(docker node ls -q | xargs -I{} docker node inspect --format '{{index .Spec.Labels "role"}}' {} 2>/dev/null | grep -c "gateway" || true)

  if [ "$has_db1" -eq 0 ] || [ "$has_db2" -eq 0 ] || [ "$has_gateway" -eq 0 ]; then
    log_error "缺少必要的节点标签（需要 db-1, db-2, gateway），请先执行: $0 labels"
    exit 1
  fi

  # 检查 Worker 节点
  local worker_count
  worker_count=$(docker node ls --filter "role=worker" -q | wc -l | tr -d ' ')
  if [ "$worker_count" -lt 2 ]; then
    log_warn "Worker 节点不足 2 个（当前 $worker_count 个），应用服务副本可能无法均匀分布"
  fi

  log_info "Registry: $REGISTRY"
  log_info "Tag: $TAG"

  # 部署
  REGISTRY="$REGISTRY" TAG="$TAG" CORS_ORIGINS="${CORS_ORIGINS:-}" \
    docker stack deploy -c "$SCRIPT_DIR/docker-stack.yml" "$STACK_NAME"

  echo ""
  log_ok "Stack '$STACK_NAME' 部署命令已发送"
  log_info "等待服务启动..."
  sleep 5

  # 显示服务状态
  docker stack services "$STACK_NAME"
  echo ""
  log_info "查看详细状态: docker stack services $STACK_NAME"
  log_info "查看服务日志: docker service logs ${STACK_NAME}_<service-name>"
  log_info "查看任务状态: docker stack ps $STACK_NAME"
}

# 查看状态
show_status() {
  log_info "═══ Stack 状态: $STACK_NAME ═══"
  echo ""

  if ! docker stack ls 2>/dev/null | grep -q "$STACK_NAME"; then
    log_warn "Stack '$STACK_NAME' 未部署"
    return
  fi

  log_info "── 服务状态 ──"
  docker stack services "$STACK_NAME"
  echo ""

  log_info "── 任务状态 ──"
  docker stack ps "$STACK_NAME" --no-trunc 2>/dev/null | head -30
  echo ""

  log_info "── 节点状态 ──"
  docker node ls
}

# 销毁 Stack
destroy_stack() {
  log_warn "即将销毁 Stack: $STACK_NAME"
  read -rp "确认删除？(输入 'yes' 确认): " confirm
  if [ "$confirm" = "yes" ]; then
    docker stack rm "$STACK_NAME"
    log_ok "Stack '$STACK_NAME' 已删除"
    log_warn "注意：持久化 Volume 不会被自动删除，如需清理请手动执行 docker volume prune"
  else
    log_info "取消操作"
  fi
}

# ══════════════════════════════════════════════════
# 主入口
# ══════════════════════════════════════════════════

usage() {
  echo "用法: $0 <command>"
  echo ""
  echo "命令:"
  echo "  init      初始化 Swarm 集群（仅在 S1 执行一次）"
  echo "  labels    设置节点标签（init 后执行）"
  echo "  secrets   创建 Docker Secrets"
  echo "  build     构建并推送所有服务镜像"
  echo "  deploy    部署/更新 Stack"
  echo "  status    查看 Stack 状态"
  echo "  destroy   销毁 Stack"
  echo "  full      完整流程: init → labels → secrets → build → deploy"
  echo ""
  echo "环境变量:"
  echo "  REGISTRY     镜像仓库地址（必须，如: registry.example.com/ecom）"
  echo "  TAG          镜像标签（默认: latest）"
  echo "  MANAGER_IP   Manager 节点 IP（init 时使用）"
  echo "  CORS_ORIGINS 允许的 CORS 来源（逗号分隔）"
}

case "${1:-}" in
  init)
    check_docker
    init_swarm
    ;;
  labels)
    check_docker
    set_labels
    ;;
  secrets)
    check_docker
    create_secrets
    ;;
  build)
    check_docker
    build_images
    ;;
  deploy)
    check_docker
    deploy_stack
    ;;
  status)
    check_docker
    show_status
    ;;
  destroy)
    check_docker
    destroy_stack
    ;;
  full)
    check_docker
    init_swarm
    echo ""
    read -rp "所有节点已加入集群？按 Enter 继续设置标签..." _
    set_labels
    echo ""
    create_secrets
    echo ""
    build_images
    echo ""
    deploy_stack
    ;;
  *)
    usage
    exit 1
    ;;
esac
