#!/usr/bin/env bash
# deploy.sh — K8s 部署脚本（替代 infra/swarm/deploy.sh）
# 用法: ./deploy.sh <command>
# 命令: setup | build | deploy | status | destroy | migrate | rollback | full
set -euo pipefail

# ============ 配置 ============
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CHART_DIR="${PROJECT_ROOT}/infra/charts/ecom-chart"
NAMESPACE="ecom"
RELEASE_NAME="ecom"

# 环境变量（可覆盖）
REGISTRY="${REGISTRY:?请设置 REGISTRY 环境变量，如 registry.example.com/ecom}"
TAG="${TAG:-latest}"
CORS_ORIGINS="${CORS_ORIGINS:-}"
REDIS_SERVICE_NAME="${REDIS_SERVICE_NAME:-${RELEASE_NAME}-redis}"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ============ 前置检查 ============
check_kubectl() {
  if ! command -v kubectl &>/dev/null; then
    log_error "kubectl 未安装"
    exit 1
  fi
  if ! kubectl cluster-info &>/dev/null; then
    log_error "无法连接到 K8s 集群，请检查 kubeconfig"
    exit 1
  fi
}

check_helm() {
  if ! command -v helm &>/dev/null; then
    log_error "helm 未安装"
    exit 1
  fi
}

# ============ setup — 初始化命名空间、验证 Operator、创建 Secret ============
cmd_setup() {
  check_kubectl

  log_info "检查 Operator 就绪状态..."

  # 检查 CloudNativePG
  if kubectl get deployment cnpg-controller-manager -n cnpg-system &>/dev/null; then
    log_ok "CloudNativePG Operator 已就绪"
  else
    log_error "CloudNativePG Operator 未安装，请先运行 cluster-setup/06-install-operators.sh"
    exit 1
  fi

  # 检查 Redis Operator
  if kubectl get deployment redis-operator-redis-operator -n redis-operator-system &>/dev/null; then
    log_ok "Redis Operator 已就绪"
  else
    log_warn "Redis Operator 可能未安装，请确认 redis-operator-system namespace 中有运行的 Pod"
  fi

  # 检查 Ingress Controller
  if kubectl get pods -n ingress-nginx -l app.kubernetes.io/component=controller --no-headers 2>/dev/null | grep -q Running; then
    log_ok "Nginx Ingress Controller 已就绪"
  else
    log_warn "Nginx Ingress Controller 可能未就绪"
  fi

  # 检查 cert-manager
  if kubectl get deployment cert-manager -n cert-manager &>/dev/null; then
    log_ok "cert-manager 已就绪"
  else
    log_warn "cert-manager 可能未安装"
  fi

  log_info "创建 namespace ${NAMESPACE}..."
  kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

  log_info "交互式创建 Secrets..."
  echo ""

  read -s -p "输入 PostgreSQL 密码 (最少 8 位): " PG_PASS
  echo ""
  if [[ ${#PG_PASS} -lt 8 ]]; then
    log_error "PostgreSQL 密码长度不足 8 位"
    exit 1
  fi

  read -s -p "输入 Replication 密码 (最少 8 位): " REPL_PASS
  echo ""
  if [[ ${#REPL_PASS} -lt 8 ]]; then
    log_error "Replication 密码长度不足 8 位"
    exit 1
  fi

  read -s -p "输入 JWT Access Secret (最少 16 位): " JWT_ACCESS
  echo ""
  if [[ ${#JWT_ACCESS} -lt 16 ]]; then
    log_error "JWT Access Secret 长度不足 16 位"
    exit 1
  fi

  read -s -p "输入 JWT Refresh Secret (最少 16 位): " JWT_REFRESH
  echo ""
  if [[ ${#JWT_REFRESH} -lt 16 ]]; then
    log_error "JWT Refresh Secret 长度不足 16 位"
    exit 1
  fi

  read -s -p "输入 Internal Secret (最少 8 位): " INTERNAL_SECRET
  echo ""
  if [[ ${#INTERNAL_SECRET} -lt 8 ]]; then
    log_error "Internal Secret 长度不足 8 位"
    exit 1
  fi

  # 保存到临时文件供 helm install 使用
  SECRETS_FILE="${SCRIPT_DIR}/.secrets.yaml"
  cat > "${SECRETS_FILE}" <<EOF
secrets:
  postgresPassword: "${PG_PASS}"
  replicationPassword: "${REPL_PASS}"
  jwtAccessSecret: "${JWT_ACCESS}"
  jwtRefreshSecret: "${JWT_REFRESH}"
  internalSecret: "${INTERNAL_SECRET}"
EOF
  chmod 600 "${SECRETS_FILE}"

  log_ok "Secrets 已保存到 ${SECRETS_FILE}"
  log_warn "部署完成后请删除此文件: rm ${SECRETS_FILE}"
  echo ""
  log_ok "Setup 完成！下一步: ./deploy.sh build && ./deploy.sh deploy"
}

# ============ build — 构建并推送所有服务镜像 ============
cmd_build() {
  log_info "构建服务镜像 (TAG=${TAG})..."

  declare -A SERVICE_MAP=(
    ["api-gateway"]="apps/api-gateway/Dockerfile"
    ["user-service"]="services/user-service/Dockerfile"
    ["product-service"]="services/product-service/Dockerfile"
    ["cart-service"]="services/cart-service/Dockerfile"
    ["order-service"]="services/order-service/Dockerfile"
  )

  for SERVICE in "${!SERVICE_MAP[@]}"; do
    DOCKERFILE="${SERVICE_MAP[$SERVICE]}"
    IMAGE="${REGISTRY}/ecom-${SERVICE}:${TAG}"

    log_info "构建 ${SERVICE}..."
    docker build \
      -t "${IMAGE}" \
      -f "${PROJECT_ROOT}/${DOCKERFILE}" \
      "${PROJECT_ROOT}"

    log_info "推送 ${IMAGE}..."
    docker push "${IMAGE}"

    log_ok "${SERVICE} 构建并推送完成"
  done

  log_ok "所有镜像构建完成"
}

# ============ deploy — Helm 部署 ============
cmd_deploy() {
  check_kubectl
  check_helm

  SECRETS_FILE="${SCRIPT_DIR}/.secrets.yaml"
  HELM_ARGS=()

  if [[ -f "${SECRETS_FILE}" ]]; then
    HELM_ARGS+=(-f "${SECRETS_FILE}")
    log_info "使用 Secrets 文件: ${SECRETS_FILE}"
  else
    log_warn "未找到 .secrets.yaml，如果 Secret 已在集群中创建则忽略此警告"
  fi

  if [[ -n "${CORS_ORIGINS}" ]]; then
    HELM_ARGS+=(--set "services.corsOrigins=${CORS_ORIGINS}")
  fi

  # 若集群已有 CNPG 超级用户密码，优先使用其值覆盖 Helm，避免 CI/本地密码漂移导致鉴权失败
  PG_SECRET_NAME="${RELEASE_NAME}-pg-superuser"
  if kubectl -n "${NAMESPACE}" get secret "${PG_SECRET_NAME}" >/dev/null 2>&1; then
    PG_PASS_CLUSTER="$(kubectl -n "${NAMESPACE}" get secret "${PG_SECRET_NAME}" -o jsonpath='{.data.password}' | base64 -d)"
    if [[ -n "${PG_PASS_CLUSTER}" ]]; then
      HELM_ARGS+=(--set-string "secrets.postgresPassword=${PG_PASS_CLUSTER}")
      log_info "已从集群 Secret(${PG_SECRET_NAME}) 自动同步 PostgreSQL 密码"
    fi
  fi

  log_info "部署 Helm Chart (release=${RELEASE_NAME}, tag=${TAG})..."
  helm upgrade --install "${RELEASE_NAME}" "${CHART_DIR}" \
    --namespace "${NAMESPACE}" \
    --create-namespace \
    --set "global.registry=${REGISTRY}" \
    --set "global.imageTag=${TAG}" \
    --set "redis.serviceName=${REDIS_SERVICE_NAME}" \
    "${HELM_ARGS[@]}" \
    --wait \
    --timeout 300s

  log_ok "Helm 部署完成"
  echo ""
  cmd_status
}

# ============ status — 查看集群状态 ============
cmd_status() {
  check_kubectl

  echo ""
  echo -e "${BLUE}=== Pods ===${NC}"
  kubectl get pods -n "${NAMESPACE}" -o wide

  echo ""
  echo -e "${BLUE}=== Services ===${NC}"
  kubectl get svc -n "${NAMESPACE}"

  echo ""
  echo -e "${BLUE}=== Ingress ===${NC}"
  kubectl get ingress -n "${NAMESPACE}" 2>/dev/null || echo "  (无 Ingress 资源)"

  echo ""
  echo -e "${BLUE}=== CloudNativePG Cluster ===${NC}"
  kubectl get cluster -n "${NAMESPACE}" 2>/dev/null || echo "  (无 CloudNativePG 资源)"

  echo ""
  echo -e "${BLUE}=== Redis Replication ===${NC}"
  kubectl get redisreplication -n "${NAMESPACE}" 2>/dev/null || echo "  (无 Redis 资源)"

  echo ""
  echo -e "${BLUE}=== Certificates ===${NC}"
  kubectl get certificate -n "${NAMESPACE}" 2>/dev/null || echo "  (无 Certificate 资源)"

  echo ""
  echo -e "${BLUE}=== Helm Release ===${NC}"
  helm list -n "${NAMESPACE}" 2>/dev/null || echo "  (无 Helm release)"
}

# ============ destroy — 卸载 Helm release ============
cmd_destroy() {
  check_kubectl
  check_helm

  echo ""
  log_warn "即将删除 Helm release '${RELEASE_NAME}' 及 namespace '${NAMESPACE}' 中的所有资源"
  log_warn "CloudNativePG 和 Redis 的 PVC 将被保留（需手动清理）"
  echo ""
  read -p "确认删除？(输入 yes): " CONFIRM
  if [[ "${CONFIRM}" != "yes" ]]; then
    log_info "操作已取消"
    exit 0
  fi

  log_info "卸载 Helm release..."
  helm uninstall "${RELEASE_NAME}" -n "${NAMESPACE}" || true

  log_info "删除 namespace..."
  kubectl delete namespace "${NAMESPACE}" --ignore-not-found

  log_ok "资源已清理"
  log_info "如需清理 PVC: kubectl get pvc -n ${NAMESPACE}"
}

# ============ migrate — 手动触发数据库迁移 ============
cmd_migrate() {
  check_kubectl

  log_info "触发数据库迁移 Job..."

  # 删除旧的迁移 Job（如果存在）
  kubectl delete job "${RELEASE_NAME}-db-migrate" -n "${NAMESPACE}" --ignore-not-found

  # 使用 api-gateway 镜像运行迁移
  kubectl create job "${RELEASE_NAME}-db-migrate" \
    --namespace "${NAMESPACE}" \
    --image="${REGISTRY}/ecom-api-gateway:${TAG}" \
    --from=cronjob/"${RELEASE_NAME}-db-migrate" 2>/dev/null || {
    # 如果没有 CronJob，直接创建 Job
    cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${RELEASE_NAME}-db-migrate
  namespace: ${NAMESPACE}
spec:
  backoffLimit: 3
  activeDeadlineSeconds: 120
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: migrate
          image: ${REGISTRY}/ecom-api-gateway:${TAG}
          command: ["bun", "run", "packages/database/src/migrate.ts"]
          envFrom:
            - secretRef:
                name: ${RELEASE_NAME}-secrets
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: ${RELEASE_NAME}-secrets
                  key: postgres-password
            - name: DATABASE_URL
              value: "postgresql://postgres:\$(POSTGRES_PASSWORD)@${RELEASE_NAME}-pg-rw:5432/ecommerce"
EOF
  }

  log_info "等待迁移完成..."
  kubectl wait --for=condition=complete --timeout=120s \
    job/"${RELEASE_NAME}-db-migrate" -n "${NAMESPACE}" || {
    log_error "迁移未在 120s 内完成，查看日志:"
    kubectl logs job/"${RELEASE_NAME}-db-migrate" -n "${NAMESPACE}"
    exit 1
  }

  log_ok "数据库迁移完成"
  kubectl logs job/"${RELEASE_NAME}-db-migrate" -n "${NAMESPACE}"
}

# ============ rollback — Helm 回滚 ============
cmd_rollback() {
  check_kubectl
  check_helm

  REVISION="${1:-}"

  if [[ -z "${REVISION}" ]]; then
    log_info "当前 Helm 历史:"
    helm history "${RELEASE_NAME}" -n "${NAMESPACE}"
    echo ""
    read -p "输入要回滚到的版本号: " REVISION
  fi

  log_info "回滚到版本 ${REVISION}..."
  helm rollback "${RELEASE_NAME}" "${REVISION}" -n "${NAMESPACE}" --wait

  log_ok "回滚完成"
  cmd_status
}

# ============ full — 完整部署流程 ============
cmd_full() {
  cmd_setup
  echo ""
  cmd_build
  echo ""
  cmd_deploy
}

# ============ 主入口 ============
usage() {
  echo "用法: $0 <command>"
  echo ""
  echo "命令:"
  echo "  setup     初始化命名空间、验证 Operator、交互式创建 Secret"
  echo "  build     构建并推送所有服务镜像"
  echo "  deploy    Helm 部署/升级"
  echo "  status    查看集群状态"
  echo "  destroy   卸载 Helm release 并清理资源"
  echo "  migrate   手动触发数据库迁移"
  echo "  rollback  Helm 回滚到指定版本"
  echo "  full      完整流程: setup → build → deploy"
  echo ""
  echo "环境变量:"
  echo "  REGISTRY       (必须) 镜像仓库地址，如 registry.example.com/ecom"
  echo "  TAG            (可选) 镜像标签，默认 latest"
  echo "  CORS_ORIGINS   (可选) 允许的跨域来源，逗号分隔"
  echo "  REDIS_SERVICE_NAME (可选) Redis Service 名称，默认 <release>-redis"
}

COMMAND="${1:-}"
shift || true

case "${COMMAND}" in
  setup)    cmd_setup ;;
  build)    cmd_build ;;
  deploy)   cmd_deploy ;;
  status)   cmd_status ;;
  destroy)  cmd_destroy ;;
  migrate)  cmd_migrate ;;
  rollback) cmd_rollback "$@" ;;
  full)     cmd_full ;;
  *)
    usage
    exit 1
    ;;
esac
