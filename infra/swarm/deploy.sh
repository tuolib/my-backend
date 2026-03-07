#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# deploy.sh — Docker Swarm 部署管理
# ═══════════════════════════════════════════════════════════════
#
# 集群管理:  init / setup
# 部署运维:  deploy / migrate / status / logs / rollback / reload / scale
# 清理:     destroy

set -euo pipefail

STACK_NAME="${STACK_NAME:-ecom}"
REGISTRY="${REGISTRY:-}"
TAG="${TAG:-latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_FILE="$SCRIPT_DIR/docker-stack.yml"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERR]${NC}   $*"; }

require_swarm() {
  docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "active" \
    || { err "不在 Swarm 模式，先执行: $0 init"; exit 1; }
}

require_registry() {
  [ -n "$REGISTRY" ] || { err "REGISTRY 未设置，例: REGISTRY=ghcr.io/org $0 deploy"; exit 1; }
}

# ═══════════════════════════════════════
# init
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
  info "Manager 加入命令（S2, S3）："
  docker swarm join-token manager 2>/dev/null || true
  echo ""
  info "Worker 加入命令（S4, S5）："
  docker swarm join-token worker 2>/dev/null || true
  echo ""
  warn "所有节点加入后执行: $0 setup"
}

# ═══════════════════════════════════════
# setup — 标签 + Secrets
# ═══════════════════════════════════════

cmd_setup() {
  require_swarm

  # 标签
  info "═══ 节点标签 ═══"
  docker node ls
  echo ""
  echo "  db-primary  PG主+Redis主(S1)  |  db-replica  PG从+Redis从(S2)"
  echo "  gateway     Nginx入口(S3)     |  skip        应用节点(S4/S5)"
  echo ""
  for node in $(docker node ls --format '{{.Hostname}}'); do
    read -rp "  $node -> [db-primary/db-replica/gateway/skip]: " role
    case "$role" in
      db-primary|db-replica|gateway)
        docker node update --label-add role="$role" "$node"
        ok "$node -> $role" ;;
      *) info "$node -> 跳过" ;;
    esac
  done

  # Secrets
  echo ""
  info "═══ Secrets ═══"
  local names=(postgres_password jwt_access_secret jwt_refresh_secret internal_secret)
  local mins=(8 16 16 8)
  for i in "${!names[@]}"; do
    if docker secret inspect "${names[$i]}" &>/dev/null; then
      ok "${names[$i]} 已存在"; continue
    fi
    read -rsp "  ${names[$i]} (>=${mins[$i]}字符): " val; echo ""
    [ ${#val} -ge "${mins[$i]}" ] || { err "长度不足"; exit 1; }
    echo -n "$val" | docker secret create "${names[$i]}" -
    ok "${names[$i]} 已创建"
  done
  echo ""
  ok "就绪（SSL 由 certbot 自动管理）"
}

# ═══════════════════════════════════════
# deploy
# ═══════════════════════════════════════

cmd_deploy() {
  require_swarm
  require_registry

  # 前置检查
  for s in postgres_password jwt_access_secret jwt_refresh_secret internal_secret; do
    docker secret inspect "$s" &>/dev/null || { err "Secret '$s' 缺失，先执行: $0 setup"; exit 1; }
  done
  local labels
  labels=$(docker node ls -q | xargs -I{} docker node inspect --format '{{range $k,$v := .Spec.Labels}}{{$v}} {{end}}' {} 2>/dev/null)
  for role in db-primary db-replica gateway; do
    echo "$labels" | grep -q "$role" || { err "缺少 '$role' 标签，先执行: $0 setup"; exit 1; }
  done

  info "部署 $STACK_NAME  registry=$REGISTRY  tag=$TAG"

  REGISTRY="$REGISTRY" TAG="$TAG" \
    CORS_ORIGINS="${CORS_ORIGINS:-}" \
    CERTBOT_DOMAIN="${CERTBOT_DOMAIN:-api.find345.site}" \
    CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@find345.site}" \
    docker stack deploy -c "$STACK_FILE" "$STACK_NAME" --with-registry-auth

  wait_for_services

  echo ""
  info "首次部署后执行: $0 reload nginx （加载真实 SSL 证书）"
  info "DNS: 将域名 A 记录指向 S3/S4/S5 的公网 IP"
}

wait_for_services() {
  info "等待服务收敛..."
  local timeout=180 elapsed=0
  while [ $elapsed -lt $timeout ]; do
    local not_ready
    not_ready=$(docker stack services "$STACK_NAME" --format '{{.Replicas}}' 2>/dev/null \
      | awk -F'/' '$1 != $2 { n++ } END { print n+0 }')
    [ "$not_ready" -eq 0 ] && { echo ""; ok "所有服务就绪"; docker stack services "$STACK_NAME"; return 0; }
    printf "."
    sleep 5; elapsed=$((elapsed + 5))
  done
  echo ""
  warn "超时 (${timeout}s)，部分服务未就绪"
  docker stack services "$STACK_NAME"
}

# ═══════════════════════════════════════
# migrate
# ═══════════════════════════════════════

cmd_migrate() {
  require_swarm; require_registry
  info "运行数据库迁移..."
  docker service rm "${STACK_NAME}_migrate" 2>/dev/null || true

  docker service create --name "${STACK_NAME}_migrate" \
    --network "${STACK_NAME}_data_net" \
    --secret postgres_password \
    --restart-condition none \
    --entrypoint sh \
    "${REGISTRY}/ecom-api-gateway:${TAG}" \
    -c 'export DATABASE_URL="postgresql://postgres:$(cat /run/secrets/postgres_password)@postgres-primary:5432/ecommerce" && bun run src/db/migrate.ts'

  local timeout=120 elapsed=0
  while [ $elapsed -lt $timeout ]; do
    local state
    state=$(docker service ps "${STACK_NAME}_migrate" --format '{{.CurrentState}}' 2>/dev/null | head -1)
    echo "$state" | grep -qi "complete" && { ok "迁移完成"; docker service rm "${STACK_NAME}_migrate" &>/dev/null; return 0; }
    echo "$state" | grep -qi "failed\|rejected" && { err "迁移失败"; docker service logs "${STACK_NAME}_migrate" --tail 20 2>/dev/null; docker service rm "${STACK_NAME}_migrate" &>/dev/null; return 1; }
    sleep 3; elapsed=$((elapsed + 3))
  done
  warn "迁移超时"; docker service rm "${STACK_NAME}_migrate" &>/dev/null; return 1
}

# ═══════════════════════════════════════
# status / logs / rollback / reload / scale
# ═══════════════════════════════════════

cmd_status() {
  require_swarm
  docker stack ls 2>/dev/null | grep -q "$STACK_NAME" || { warn "Stack 未部署"; return; }
  info "═══ 服务 ═══"
  docker stack services "$STACK_NAME"
  echo ""
  info "═══ 节点 ═══"
  docker node ls
  echo ""
  info "═══ 最近失败 ═══"
  docker stack ps "$STACK_NAME" --filter "desired-state=shutdown" \
    --format "table {{.Name}}\t{{.CurrentState}}\t{{.Error}}" 2>/dev/null | head -6 || ok "无"
}

cmd_logs() {
  [ -n "${1:-}" ] || { err "用法: $0 logs <service>"; exit 1; }
  docker service logs "${STACK_NAME}_${1}" --tail 100 --follow
}

cmd_rollback() {
  [ -n "${1:-}" ] || { err "用法: $0 rollback <service>"; exit 1; }
  info "回滚 ${1}..."
  docker service rollback "${STACK_NAME}_${1}"
  ok "${1} 已回滚"
}

cmd_reload() {
  [ -n "${1:-}" ] || { err "用法: $0 reload <service>  (常用: reload nginx)"; exit 1; }
  info "强制重启 ${1}（滚动更新）..."
  docker service update --force "${STACK_NAME}_${1}"
  ok "${1} 已重载"
}

cmd_scale() {
  [ -n "${1:-}" ] && [ -n "${2:-}" ] || { err "用法: $0 scale <service> <count>"; exit 1; }
  docker service scale "${STACK_NAME}_${1}=${2}"
  ok "${1} 已扩缩至 ${2} 副本"
}

# ═══════════════════════════════════════
# destroy
# ═══════════════════════════════════════

cmd_destroy() {
  require_swarm
  warn "即将销毁 Stack: $STACK_NAME"
  read -rp "输入 'yes' 确认: " confirm
  [ "$confirm" = "yes" ] || { info "已取消"; return; }
  docker stack rm "$STACK_NAME"
  ok "已删除（Volume 保留，清理: docker volume prune）"
}

# ═══════════════════════════════════════
# main
# ═══════════════════════════════════════

usage() {
  cat <<'EOF'
用法: deploy.sh <command> [args]

集群:
  init              初始化 Swarm（仅 S1 首次）
  setup             节点标签 + Secrets

部署:
  deploy            部署/更新 Stack
  migrate           数据库迁移
  status            服务状态
  logs     <svc>    查看日志
  rollback <svc>    回滚服务
  reload   <svc>    强制重启（如: reload nginx 加载新证书）
  scale    <svc> N  扩缩容

清理:
  destroy           销毁 Stack

环境变量:
  REGISTRY  TAG  CERTBOT_DOMAIN  CERTBOT_EMAIL  CORS_ORIGINS  STACK_NAME
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
  reload)   cmd_reload "${2:-}" ;;
  scale)    cmd_scale "${2:-}" "${3:-}" ;;
  destroy)  cmd_destroy ;;
  *)        usage; exit 1 ;;
esac
