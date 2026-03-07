#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# deploy.sh — Docker Swarm 部署管理
# ═══════════════════════════════════════════════════════════════
#
# 命令:
#   init      初始化 Swarm 集群（仅首次）
#   setup     设置节点标签 + 创建 Secrets（交互式）
#   deploy    部署/更新 Stack
#   migrate   运行数据库迁移
#   status    查看服务状态
#   logs      查看服务日志     (deploy.sh logs <service>)
#   rollback  回滚指定服务     (deploy.sh rollback <service>)
#   destroy   销毁 Stack
#
# 环境变量:
#   REGISTRY        镜像仓库（必须）
#   TAG             镜像标签（默认: latest）
#   CERTBOT_DOMAIN  域名（默认: api.find345.site）
#   CERTBOT_EMAIL   邮箱（默认: admin@find345.site）
#   CORS_ORIGINS    CORS 来源
#   STACK_NAME      Stack 名称（默认: ecom）

set -euo pipefail

# ── 配置 ──
STACK_NAME="${STACK_NAME:-ecom}"
REGISTRY="${REGISTRY:-}"
TAG="${TAG:-latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STACK_FILE="$SCRIPT_DIR/docker-stack.yml"

# ── 输出 ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERR]${NC}   $*"; }

require_swarm() {
  if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "active"; then
    err "当前节点不在 Swarm 模式，请先执行: $0 init"
    exit 1
  fi
}

require_registry() {
  if [ -z "$REGISTRY" ]; then
    err "REGISTRY 未设置，例: REGISTRY=ghcr.io/your-org $0 deploy"
    exit 1
  fi
}

# ═══════════════════════════════════════
# init — 初始化 Swarm
# ═══════════════════════════════════════

cmd_init() {
  if docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "active"; then
    warn "已在 Swarm 模式中"
  else
    info "初始化 Swarm..."
    docker swarm init --advertise-addr "${MANAGER_IP:-$(hostname -I | awk '{print $1}')}"
    ok "Swarm 初始化完成"
  fi

  echo ""
  info "Manager 加入命令（S2, S3 执行）："
  docker swarm join-token manager 2>/dev/null || true
  echo ""
  info "Worker 加入命令（S4, S5 执行）："
  docker swarm join-token worker 2>/dev/null || true
  echo ""
  warn "所有节点加入后，执行: $0 setup"
}

# ═══════════════════════════════════════
# setup — 节点标签 + Secrets
# ═══════════════════════════════════════

cmd_setup() {
  require_swarm
  setup_labels
  echo ""
  setup_secrets
}

setup_labels() {
  info "═══ 节点标签 ═══"
  docker node ls
  echo ""
  echo "角色说明:"
  echo "  db-primary  — PG主 + Redis主（S1）"
  echo "  db-replica  — PG从 + Redis从（S2）"
  echo "  gateway     — Nginx 入口（S3）"
  echo "  skip        — 应用节点，无需标签（S4/S5）"
  echo ""

  local nodes
  nodes=$(docker node ls --format '{{.Hostname}}')
  for node in $nodes; do
    read -rp "  $node -> [db-primary/db-replica/gateway/skip]: " role
    case "$role" in
      db-primary|db-replica|gateway)
        docker node update --label-add role="$role" "$node"
        ok "$node -> $role"
        ;;
      *) info "$node -> 跳过" ;;
    esac
  done
}

setup_secrets() {
  info "═══ Secrets ═══"
  local secrets=(postgres_password jwt_access_secret jwt_refresh_secret internal_secret)
  local min_lens=(8 16 16 8)

  for i in "${!secrets[@]}"; do
    local name="${secrets[$i]}"
    local min="${min_lens[$i]}"

    if docker secret inspect "$name" &>/dev/null; then
      ok "$name 已存在"
      continue
    fi

    read -rsp "  $name (最少 ${min} 字符): " value
    echo ""

    if [ ${#value} -lt "$min" ]; then
      err "$name 长度不足 $min 字符"
      exit 1
    fi

    echo -n "$value" | docker secret create "$name" -
    ok "$name 已创建"
  done

  echo ""
  ok "Secrets 就绪（SSL 证书由 certbot 自动管理）"
}

# ═══════════════════════════════════════
# deploy — 部署/更新 Stack
# ═══════════════════════════════════════

cmd_deploy() {
  require_swarm
  require_registry

  # 检查 Secrets
  local secrets=(postgres_password jwt_access_secret jwt_refresh_secret internal_secret)
  for s in "${secrets[@]}"; do
    if ! docker secret inspect "$s" &>/dev/null; then
      err "Secret '$s' 不存在，请先执行: $0 setup"
      exit 1
    fi
  done

  # 检查节点标签
  local labels
  labels=$(docker node ls -q | xargs -I{} docker node inspect --format '{{range $k,$v := .Spec.Labels}}{{$v}} {{end}}' {} 2>/dev/null | tr ' ' '\n')
  for role in db-primary db-replica gateway; do
    if ! echo "$labels" | grep -q "^${role}$"; then
      err "缺少 '${role}' 节点标签，请先执行: $0 setup"
      exit 1
    fi
  done

  info "部署 Stack: $STACK_NAME"
  info "  Registry: $REGISTRY"
  info "  Tag:      $TAG"
  info "  Domain:   ${CERTBOT_DOMAIN:-api.find345.site}"

  REGISTRY="$REGISTRY" TAG="$TAG" \
    CORS_ORIGINS="${CORS_ORIGINS:-}" \
    CERTBOT_DOMAIN="${CERTBOT_DOMAIN:-api.find345.site}" \
    CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@find345.site}" \
    docker stack deploy -c "$STACK_FILE" "$STACK_NAME" --with-registry-auth

  wait_for_services

  echo ""
  info "DNS 配置: 将域名 A 记录指向 S3/S4/S5 的公网 IP"
  info "SSL 证书: certbot 自动申请（首次约 1-2 分钟）"
}

wait_for_services() {
  info "等待服务收敛..."
  local timeout=180
  local elapsed=0

  while [ $elapsed -lt $timeout ]; do
    local not_ready
    not_ready=$(docker stack services "$STACK_NAME" --format '{{.Replicas}}' 2>/dev/null \
      | awk -F'/' '$1 != $2 { n++ } END { print n+0 }')

    if [ "$not_ready" -eq 0 ]; then
      echo ""
      ok "所有服务就绪"
      docker stack services "$STACK_NAME"
      return 0
    fi

    printf "."
    sleep 5
    elapsed=$((elapsed + 5))
  done

  echo ""
  warn "部分服务未就绪（${timeout}s 超时）"
  docker stack services "$STACK_NAME"
  echo ""
  info "查看失败任务: docker stack ps $STACK_NAME --no-trunc | grep -v Running"
}

# ═══════════════════════════════════════
# migrate — 数据库迁移
# ═══════════════════════════════════════

cmd_migrate() {
  require_swarm
  require_registry
  info "运行数据库迁移..."

  # 清理上次残留
  docker service rm "${STACK_NAME}_migrate" 2>/dev/null || true

  docker service create \
    --name "${STACK_NAME}_migrate" \
    --network "${STACK_NAME}_data_net" \
    --secret postgres_password \
    --restart-condition none \
    --entrypoint sh \
    "${REGISTRY}/ecom-api-gateway:${TAG}" \
    -c 'export DATABASE_URL="postgresql://postgres:$(cat /run/secrets/postgres_password)@postgres-primary:5432/ecommerce" && bun run src/db/migrate.ts'

  # 等待完成
  local timeout=120
  local elapsed=0
  while [ $elapsed -lt $timeout ]; do
    local state
    state=$(docker service ps "${STACK_NAME}_migrate" --format '{{.CurrentState}}' 2>/dev/null | head -1)

    if echo "$state" | grep -qi "complete"; then
      ok "迁移完成"
      docker service rm "${STACK_NAME}_migrate" 2>/dev/null || true
      return 0
    fi

    if echo "$state" | grep -qi "failed\|rejected"; then
      err "迁移失败"
      docker service logs "${STACK_NAME}_migrate" --tail 30 2>/dev/null || true
      docker service rm "${STACK_NAME}_migrate" 2>/dev/null || true
      return 1
    fi

    sleep 3
    elapsed=$((elapsed + 3))
  done

  warn "迁移超时 (${timeout}s)"
  docker service rm "${STACK_NAME}_migrate" 2>/dev/null || true
  return 1
}

# ═══════════════════════════════════════
# status — 服务状态
# ═══════════════════════════════════════

cmd_status() {
  require_swarm

  if ! docker stack ls 2>/dev/null | grep -q "$STACK_NAME"; then
    warn "Stack '$STACK_NAME' 未部署"
    return
  fi

  info "═══ 服务 ═══"
  docker stack services "$STACK_NAME"
  echo ""
  info "═══ 节点 ═══"
  docker node ls
  echo ""
  info "═══ 失败任务 ═══"
  local failed
  failed=$(docker stack ps "$STACK_NAME" --filter "desired-state=shutdown" --format "{{.Name}} {{.CurrentState}} {{.Error}}" 2>/dev/null | head -5)
  if [ -n "$failed" ]; then
    echo "$failed"
  else
    ok "无失败任务"
  fi
}

# ═══════════════════════════════════════
# logs — 查看日志
# ═══════════════════════════════════════

cmd_logs() {
  local service="${1:-}"
  if [ -z "$service" ]; then
    err "用法: $0 logs <service>"
    echo "  可选: nginx api-gateway user-service product-service cart-service order-service"
    echo "        postgres-primary postgres-replica redis-primary certbot"
    exit 1
  fi
  docker service logs "${STACK_NAME}_${service}" --tail 100 --follow
}

# ═══════════════════════════════════════
# rollback — 回滚服务
# ═══════════════════════════════════════

cmd_rollback() {
  local service="${1:-}"
  if [ -z "$service" ]; then
    err "用法: $0 rollback <service>"
    exit 1
  fi
  info "回滚 ${service}..."
  docker service rollback "${STACK_NAME}_${service}"
  ok "${service} 已回滚"
}

# ═══════════════════════════════════════
# destroy — 销毁 Stack
# ═══════════════════════════════════════

cmd_destroy() {
  require_swarm
  warn "即将销毁 Stack: $STACK_NAME"
  read -rp "输入 'yes' 确认: " confirm
  if [ "$confirm" = "yes" ]; then
    docker stack rm "$STACK_NAME"
    ok "Stack 已删除"
    warn "Volume 未删除，如需清理: docker volume prune"
  else
    info "已取消"
  fi
}

# ═══════════════════════════════════════
# 主入口
# ═══════════════════════════════════════

usage() {
  cat <<'EOF'
用法: deploy.sh <command> [args]

集群管理:
  init          初始化 Swarm（仅 S1 执行一次）
  setup         设置节点标签 + 创建 Secrets

部署运维:
  deploy        部署/更新 Stack
  migrate       运行数据库迁移
  status        查看服务状态
  logs <svc>    查看服务日志 (e.g. logs api-gateway)
  rollback <svc> 回滚指定服务

清理:
  destroy       销毁 Stack

环境变量:
  REGISTRY       镜像仓库（必须）
  TAG            镜像标签（默认 latest）
  CERTBOT_DOMAIN 域名
  CERTBOT_EMAIL  通知邮箱
  CORS_ORIGINS   CORS 来源
EOF
}

case "${1:-}" in
  init)     cmd_init ;;
  setup)    cmd_setup ;;
  deploy)   cmd_deploy ;;
  migrate)  cmd_migrate ;;
  status)   cmd_status ;;
  logs)     cmd_logs "${2:-}" ;;
  rollback) cmd_rollback "${2:-}" ;;
  destroy)  cmd_destroy ;;
  *)        usage; exit 1 ;;
esac
