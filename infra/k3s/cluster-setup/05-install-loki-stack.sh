#!/usr/bin/env bash
# 05-install-loki-stack.sh — 安装 Loki + Promtail + Grafana 日志收集栈
#
# 安装到 monitoring 命名空间，使用 Helm Chart:
#   - Loki: 单实例模式，filesystem 存储，5Gi PVC
#   - Promtail: DaemonSet，采集 /var/log/pods/
#   - Grafana: 单实例，1Gi PVC，预配 Loki 数据源
#
# 资源占用 (request/limit):
#   Loki:     100m/128Mi → 250m/256Mi
#   Promtail:  50m/64Mi  → 100m/128Mi
#   Grafana:  100m/128Mi → 250m/256Mi
#   合计:     250m/320Mi → 600m/640Mi
#
# 访问方式（不暴露到公网）:
#   kubectl -n monitoring port-forward svc/grafana 3001:80
#
# 环境变量:
#   LOKI_STORAGE_SIZE     — Loki PVC 大小 (默认 5Gi)
#   GRAFANA_STORAGE_SIZE  — Grafana PVC 大小 (默认 1Gi)
#   GRAFANA_ADMIN_PASS    — Grafana admin 密码 (默认 admin)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOKI_STACK_DIR="${SCRIPT_DIR}/../loki-stack"

export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

# ============ kubectl 探测 ============
if command -v kubectl &>/dev/null; then
  KUBECTL="kubectl"
elif command -v k3s &>/dev/null; then
  KUBECTL="k3s kubectl"
else
  echo "错误: 未找到 kubectl 或 k3s" >&2
  exit 1
fi

if ! ${KUBECTL} get nodes &>/dev/null; then
  echo "错误: 无法连接到 k3s 集群 (KUBECONFIG=${KUBECONFIG})" >&2
  exit 1
fi

# ============ Helm 检查 ============
if ! command -v helm &>/dev/null; then
  echo "错误: Helm 未安装，请先运行 04-install-operators.sh" >&2
  exit 1
fi

# ============ 参数 ============
LOKI_STORAGE_SIZE="${LOKI_STORAGE_SIZE:-5Gi}"
GRAFANA_STORAGE_SIZE="${GRAFANA_STORAGE_SIZE:-1Gi}"
GRAFANA_ADMIN_PASS="${GRAFANA_ADMIN_PASS:-admin}"
NAMESPACE="monitoring"

echo "=========================================="
echo " Loki 日志栈安装"
echo "  Loki PVC:    ${LOKI_STORAGE_SIZE}"
echo "  Grafana PVC: ${GRAFANA_STORAGE_SIZE}"
echo "  命名空间:    ${NAMESPACE}"
echo "=========================================="

# ============ [1/4] 创建命名空间 ============
echo "=== [1/4] 创建命名空间 ${NAMESPACE} ==="
${KUBECTL} create namespace "${NAMESPACE}" --dry-run=client -o yaml | ${KUBECTL} apply -f -

# ============ [2/4] 安装 Loki ============
echo "=== [2/4] 安装 Loki ==="

helm repo add grafana https://grafana.github.io/helm-charts || true
helm repo update grafana

helm upgrade --install loki grafana/loki \
  --namespace "${NAMESPACE}" \
  --set deploymentMode=SingleBinary \
  --set loki.auth_enabled=false \
  --set loki.commonConfig.replication_factor=1 \
  --set loki.storage.type=filesystem \
  --set loki.schemaConfig.configs[0].from=2024-01-01 \
  --set loki.schemaConfig.configs[0].store=tsdb \
  --set loki.schemaConfig.configs[0].object_store=filesystem \
  --set loki.schemaConfig.configs[0].schema=v13 \
  --set loki.schemaConfig.configs[0].index.prefix=loki_index_ \
  --set loki.schemaConfig.configs[0].index.period=24h \
  --set singleBinary.replicas=1 \
  --set singleBinary.persistence.enabled=true \
  --set singleBinary.persistence.size="${LOKI_STORAGE_SIZE}" \
  --set singleBinary.resources.requests.cpu=100m \
  --set singleBinary.resources.requests.memory=128Mi \
  --set singleBinary.resources.limits.cpu=250m \
  --set singleBinary.resources.limits.memory=256Mi \
  --set read.replicas=0 \
  --set write.replicas=0 \
  --set backend.replicas=0 \
  --set chunksCache.enabled=false \
  --set resultsCache.enabled=false \
  --set gateway.enabled=false \
  --set test.enabled=false \
  --set lokiCanary.enabled=false \
  --wait --timeout 180s

echo "Loki 已安装"

# ============ [3/4] 安装 Promtail ============
echo "=== [3/4] 安装 Promtail ==="

PROMTAIL_VALUES="${LOKI_STACK_DIR}/promtail-values.yaml"

if [[ -f "${PROMTAIL_VALUES}" ]]; then
  helm upgrade --install promtail grafana/promtail \
    --namespace "${NAMESPACE}" \
    -f "${PROMTAIL_VALUES}" \
    --set "config.clients[0].url=http://loki:3100/loki/api/v1/push" \
    --set resources.requests.cpu=50m \
    --set resources.requests.memory=64Mi \
    --set resources.limits.cpu=100m \
    --set resources.limits.memory=128Mi \
    --wait --timeout 120s
else
  echo "警告: 未找到 ${PROMTAIL_VALUES}，使用默认配置"
  helm upgrade --install promtail grafana/promtail \
    --namespace "${NAMESPACE}" \
    --set "config.clients[0].url=http://loki:3100/loki/api/v1/push" \
    --set resources.requests.cpu=50m \
    --set resources.requests.memory=64Mi \
    --set resources.limits.cpu=100m \
    --set resources.limits.memory=128Mi \
    --wait --timeout 120s
fi

echo "Promtail 已安装"

# ============ [4/4] 安装 Grafana ============
echo "=== [4/4] 安装 Grafana ==="

helm upgrade --install grafana grafana/grafana \
  --namespace "${NAMESPACE}" \
  --set adminPassword="${GRAFANA_ADMIN_PASS}" \
  --set persistence.enabled=true \
  --set persistence.size="${GRAFANA_STORAGE_SIZE}" \
  --set resources.requests.cpu=100m \
  --set resources.requests.memory=128Mi \
  --set resources.limits.cpu=250m \
  --set resources.limits.memory=256Mi \
  --set 'datasources.datasources\.yaml.apiVersion=1' \
  --set 'datasources.datasources\.yaml.datasources[0].name=Loki' \
  --set 'datasources.datasources\.yaml.datasources[0].type=loki' \
  --set 'datasources.datasources\.yaml.datasources[0].url=http://loki:3100' \
  --set 'datasources.datasources\.yaml.datasources[0].access=proxy' \
  --set 'datasources.datasources\.yaml.datasources[0].isDefault=true' \
  --wait --timeout 120s

echo "Grafana 已安装"

# ============ 完成 ============
echo ""
echo "=========================================="
echo " Loki 日志栈安装完成！"
echo ""
echo " 验证："
echo "   ${KUBECTL} get pods -n ${NAMESPACE}"
echo ""
echo " 访问 Grafana（不暴露到公网）："
echo "   ${KUBECTL} -n ${NAMESPACE} port-forward svc/grafana 3001:80"
echo "   浏览器打开: http://localhost:3001"
echo "   账号: admin / ${GRAFANA_ADMIN_PASS}"
echo ""
echo " 测试日志查询（Grafana Explore → Loki）："
echo "   {namespace=\"ecom\"} | json"
echo "   {namespace=\"ecom\"} | json | traceId = \"xxx\""
echo "   {namespace=\"ecom\", service=\"order\"} | json | level = \"error\""
echo "=========================================="
