#!/usr/bin/env bash
# 04-install-operators.sh — 在 k3s server 节点运行
# 安装所有 Operator 和组件，设置节点标签（多节点模式）
#
# 与 k8s 版（06-install-operators.sh）的区别:
#   - 跳过 local-path-provisioner（k3s 内置）
#   - 跳过 Calico CNI（k3s 内置 Flannel）
#   - 检查/安装 Helm（k3s 不自带）
#   - 单节点模式不设 role 标签
#
# 环境变量:
#   K3S_MODE — single 或 multi（默认 single）
#   多节点模式需要: S1_NODE, S2_NODE, S3_NODE, S4_NODE, S5_NODE
set -euo pipefail

K3S_MODE="${K3S_MODE:-single}"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

# ============ Operator 版本（与 k8s 保持一致） ============
CNPG_VERSION="1.22.1"
REDIS_OPERATOR_VERSION="0.18.0"
INGRESS_NGINX_VERSION="4.9.1"
CERT_MANAGER_VERSION="v1.14.3"

echo "=========================================="
echo " k3s Operator 安装 (mode=${K3S_MODE})"
echo "=========================================="

# ============ [1/6] 检查集群连通性 ============
echo "=== [1/6] 检查集群连通性 ==="

# 优先用 kubectl，降级到 k3s kubectl
if command -v kubectl &>/dev/null; then
  KUBECTL="kubectl"
elif command -v k3s &>/dev/null; then
  KUBECTL="k3s kubectl"
else
  echo "错误: 未找到 kubectl 或 k3s" >&2
  exit 1
fi

if ! ${KUBECTL} get nodes &>/dev/null; then
  echo "错误: 无法连接到 k3s 集群" >&2
  echo "  KUBECONFIG=${KUBECONFIG}"
  exit 1
fi

echo "集群连通正常"
${KUBECTL} get nodes -o wide

# ============ [2/6] 检查/安装 Helm ============
echo "=== [2/6] 检查/安装 Helm ==="

if ! command -v helm &>/dev/null; then
  echo "Helm 未安装，正在安装..."
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi

helm version --short
echo "Helm 就绪"

# ============ [3/6] 节点标签（仅多节点模式） ============
echo "=== [3/6] 节点标签 ==="

if [[ "${K3S_MODE}" == "multi" ]]; then
  S1_NODE="${S1_NODE:?多节点模式请设置 S1_NODE}"
  S2_NODE="${S2_NODE:?多节点模式请设置 S2_NODE}"
  S3_NODE="${S3_NODE:?多节点模式请设置 S3_NODE}"
  S4_NODE="${S4_NODE:?多节点模式请设置 S4_NODE}"
  S5_NODE="${S5_NODE:?多节点模式请设置 S5_NODE}"

  # S1/S2: 数据层
  for NODE in "${S1_NODE}" "${S2_NODE}"; do
    ${KUBECTL} label node "${NODE}" role=data --overwrite
  done

  # S3: 入口层
  ${KUBECTL} label node "${S3_NODE}" role=ingress --overwrite

  # S4/S5: 应用层
  for NODE in "${S4_NODE}" "${S5_NODE}"; do
    ${KUBECTL} label node "${NODE}" role=app --overwrite
  done

  echo "节点标签设置完成"
  ${KUBECTL} get nodes --show-labels
else
  echo "单节点模式：跳过节点标签设置（所有 Pod 调度到同一节点）"
fi

# ============ [4/6] 验证 local-path-provisioner（k3s 内置） ============
echo "=== [4/6] 验证 StorageClass ==="

if ${KUBECTL} get storageclass local-path &>/dev/null; then
  echo "local-path StorageClass 已存在（k3s 内置）"
else
  echo "警告: 未找到 local-path StorageClass，正在手动安装..."
  ${KUBECTL} apply -f "https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.26/deploy/local-path-storage.yaml"
fi

# 确保设为默认
${KUBECTL} patch storageclass local-path \
  -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}' \
  2>/dev/null || true

echo "StorageClass 就绪"
${KUBECTL} get storageclass

# ============ [5/6] 安装 CloudNativePG + Redis Operator ============
echo "=== [5/6] 安装 CloudNativePG + Redis Operator ==="

# CloudNativePG
echo "安装 CloudNativePG Operator v${CNPG_VERSION}..."
${KUBECTL} apply --server-side -f \
  "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-${CNPG_VERSION%.*}/releases/cnpg-${CNPG_VERSION}.yaml"

echo "等待 CloudNativePG Operator 就绪..."
${KUBECTL} wait --for=condition=Available --timeout=120s \
  deployment/cnpg-controller-manager -n cnpg-system || {
  echo "警告: CloudNativePG Operator 尚未就绪，请手动检查:"
  echo "  ${KUBECTL} get pods -n cnpg-system"
}

# Redis Operator CRDs
echo "安装 Redis Operator CRDs..."
${KUBECTL} apply -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redis.yaml"
${KUBECTL} apply -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redisclusters.yaml"
${KUBECTL} apply -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redisreplications.yaml"
${KUBECTL} apply -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redissentinels.yaml"

# Redis Operator (Helm)
echo "安装 Redis Operator..."
helm repo add ot-helm https://ot-container-kit.github.io/helm-charts/ || true
helm repo update
helm upgrade --install redis-operator ot-helm/redis-operator \
  --namespace redis-operator-system --create-namespace \
  --version "${REDIS_OPERATOR_VERSION}" \
  --wait --timeout 120s

echo "CloudNativePG + Redis Operator 已安装"

# ============ [6/6] 安装 Nginx Ingress Controller + cert-manager ============
echo "=== [6/6] 安装 Nginx Ingress Controller + cert-manager ==="

# cert-manager
echo "安装 cert-manager ${CERT_MANAGER_VERSION}..."
${KUBECTL} apply -f "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"

echo "等待 cert-manager 就绪..."
${KUBECTL} wait --for=condition=Available --timeout=120s \
  deployment/cert-manager -n cert-manager || true
${KUBECTL} wait --for=condition=Available --timeout=120s \
  deployment/cert-manager-webhook -n cert-manager || true

# Nginx Ingress Controller
echo "安装 Nginx Ingress Controller ${INGRESS_NGINX_VERSION}..."
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx || true
helm repo update

# 根据模式决定 nodeSelector
NGINX_HELM_ARGS=(
  --set controller.kind=DaemonSet
  --set controller.hostNetwork=true
  --set controller.dnsPolicy=ClusterFirstWithHostNet
  --set controller.service.enabled=false
  --set controller.ingressClassResource.default=true
  --set 'controller.config.use-forwarded-headers=true'
  --set 'controller.config.compute-full-forwarded-for=true'
  --set 'controller.config.use-proxy-protocol=false'
)

if [[ "${K3S_MODE}" == "multi" ]]; then
  NGINX_HELM_ARGS+=(--set controller.nodeSelector.role=ingress)
fi

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --version "${INGRESS_NGINX_VERSION}" \
  "${NGINX_HELM_ARGS[@]}" \
  --wait --timeout 120s

echo "Nginx Ingress Controller + cert-manager 已安装"

echo ""
echo "=========================================="
echo " 所有 Operator 和组件安装完成！"
echo ""
echo " 验证："
echo "   ${KUBECTL} get pods -n cnpg-system"
echo "   ${KUBECTL} get pods -n redis-operator-system"
echo "   ${KUBECTL} get pods -n ingress-nginx"
echo "   ${KUBECTL} get pods -n cert-manager"
echo "   ${KUBECTL} get storageclass"
echo ""
echo " 下一步："
echo "   ./deploy.sh setup && ./deploy.sh deploy"
echo "=========================================="
