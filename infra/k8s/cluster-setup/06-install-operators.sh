#!/usr/bin/env bash
# 06-install-operators.sh — 仅在 S1 节点运行
# 安装所有 K8s Operator 和组件，设置节点标签
set -euo pipefail

# ============ 配置区域（部署前必须修改） ============
S1_NODE="${S1_NODE:?请设置 S1_NODE（kubectl get nodes 显示的节点名）}"
S2_NODE="${S2_NODE:?请设置 S2_NODE}"
S3_NODE="${S3_NODE:?请设置 S3_NODE}"
S4_NODE="${S4_NODE:?请设置 S4_NODE}"
S5_NODE="${S5_NODE:?请设置 S5_NODE}"
# ==================================================

CNPG_VERSION="1.22.1"
REDIS_OPERATOR_VERSION="0.18.0"
INGRESS_NGINX_VERSION="4.9.1"
CERT_MANAGER_VERSION="v1.14.3"
LOCAL_PATH_VERSION="v0.0.26"

echo "=== [1/6] 检查集群连通性 ==="
if ! kubectl get nodes &>/dev/null; then
  echo "错误: 无法连接到 K8s 集群" >&2
  exit 1
fi

echo "=== [2/6] 设置节点标签和 taint ==="

# S1/S2: 数据层节点（允许调度 PG 和 Redis Pod）
for NODE in "${S1_NODE}" "${S2_NODE}"; do
  kubectl label node "${NODE}" role=data --overwrite
  # 移除 Control Plane 的 NoSchedule taint，允许数据层 Pod 调度
  kubectl taint nodes "${NODE}" node-role.kubernetes.io/control-plane:NoSchedule- 2>/dev/null || true
done

# S3: 入口层节点（Nginx Ingress Controller）
kubectl label node "${S3_NODE}" role=ingress --overwrite
kubectl taint nodes "${S3_NODE}" node-role.kubernetes.io/control-plane:NoSchedule- 2>/dev/null || true

# S4/S5: 应用层节点（微服务）
for NODE in "${S4_NODE}" "${S5_NODE}"; do
  kubectl label node "${NODE}" role=app --overwrite
done

echo "节点标签和 taint 设置完成"
kubectl get nodes --show-labels

echo "=== [3/6] 安装 local-path-provisioner ==="
# 为裸金属环境提供本地持久化存储（替代云 PV）
kubectl apply -f "https://raw.githubusercontent.com/rancher/local-path-provisioner/${LOCAL_PATH_VERSION}/deploy/local-path-storage.yaml"

# 设为默认 StorageClass
kubectl patch storageclass local-path \
  -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'

echo "local-path-provisioner 已安装并设为默认 StorageClass"

echo "=== [4/6] 安装 CloudNativePG Operator ==="
kubectl apply --server-side -f \
  "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-${CNPG_VERSION%.*}/releases/cnpg-${CNPG_VERSION}.yaml"

echo "等待 CloudNativePG Operator 就绪..."
kubectl wait --for=condition=Available --timeout=120s \
  deployment/cnpg-controller-manager -n cnpg-system || {
  echo "警告: CloudNativePG Operator 尚未就绪，请手动检查:"
  echo "  kubectl get pods -n cnpg-system"
}

echo "=== [5/6] 安装 Redis Operator (OT-Container-Kit) ==="
# 安装 CRD
kubectl apply -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redis.yaml"
kubectl apply -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redisclusters.yaml"
kubectl apply -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redisreplications.yaml"
kubectl apply -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redissentinels.yaml"

# 安装 Operator
helm repo add ot-helm https://ot-container-kit.github.io/helm-charts/ || true
helm repo update
helm upgrade --install redis-operator ot-helm/redis-operator \
  --namespace redis-operator-system --create-namespace \
  --version "${REDIS_OPERATOR_VERSION}" \
  --wait --timeout 120s

echo "Redis Operator 已安装"

echo "=== [6/6] 安装 Nginx Ingress Controller + cert-manager ==="

# cert-manager（TLS 证书自动管理）
kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"

echo "等待 cert-manager 就绪..."
kubectl wait --for=condition=Available --timeout=120s \
  deployment/cert-manager -n cert-manager || true
kubectl wait --for=condition=Available --timeout=120s \
  deployment/cert-manager-webhook -n cert-manager || true

# Nginx Ingress Controller（DaemonSet + hostNetwork 模式，绑定 S3）
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx || true
helm repo update
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --version "${INGRESS_NGINX_VERSION}" \
  --set controller.kind=DaemonSet \
  --set controller.hostNetwork=true \
  --set controller.dnsPolicy=ClusterFirstWithHostNet \
  --set controller.nodeSelector.role=ingress \
  --set controller.service.enabled=false \
  --set controller.ingressClassResource.default=true \
  --set controller.config.use-forwarded-headers="true" \
  --set controller.config.compute-full-forwarded-for="true" \
  --set controller.config.use-proxy-protocol="false" \
  --wait --timeout 120s

echo "Nginx Ingress Controller + cert-manager 已安装"

echo ""
echo "=========================================="
echo " 所有 Operator 和组件安装完成！"
echo ""
echo " 验证："
echo "   kubectl get pods -n cnpg-system"
echo "   kubectl get pods -n redis-operator-system"
echo "   kubectl get pods -n ingress-nginx"
echo "   kubectl get pods -n cert-manager"
echo "   kubectl get storageclass"
echo ""
echo " 下一步："
echo "   cd ../ecom-chart"
echo "   helm install ecom . -n ecom --create-namespace"
echo "=========================================="
