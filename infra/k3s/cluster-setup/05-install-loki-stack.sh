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
# 访问方式:
#   公网: https://log.find345.site (Ingress + cert-manager 自动 HTTPS)
#   本地: kubectl -n monitoring port-forward svc/grafana 3001:80
#
# 环境变量:
#   GRAFANA_HOST          — Grafana 域名 (默认 log.find345.site)
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
GRAFANA_HOST="${GRAFANA_HOST:-log.find345.site}"
LOKI_STORAGE_SIZE="${LOKI_STORAGE_SIZE:-5Gi}"
GRAFANA_STORAGE_SIZE="${GRAFANA_STORAGE_SIZE:-1Gi}"
GRAFANA_ADMIN_PASS="${GRAFANA_ADMIN_PASS:-admin}"
NAMESPACE="monitoring"

echo "=========================================="
echo " Loki 日志栈安装"
echo "  Grafana 域名: ${GRAFANA_HOST}"
echo "  Loki PVC:     ${LOKI_STORAGE_SIZE}"
echo "  Grafana PVC:  ${GRAFANA_STORAGE_SIZE}"
echo "  命名空间:     ${NAMESPACE}"
echo "=========================================="

# ============ [1/5] 创建命名空间 ============
echo "=== [1/5] 创建命名空间 ${NAMESPACE} ==="
${KUBECTL} create namespace "${NAMESPACE}" --dry-run=client -o yaml | ${KUBECTL} apply -f -

# ============ [2/5] 安装 Loki ============
echo "=== [2/5] 安装 Loki ==="

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
  --set loki.limits_config.retention_period=168h \
  --set loki.compactor.retention_enabled=true \
  --set loki.compactor.delete_request_store=filesystem \
  --set loki.compactor.compaction_interval=10m \
  --set loki.compactor.retention_delete_delay=2h \
  --set loki.compactor.retention_delete_worker_count=150 \
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

# ============ [3/5] 安装 Promtail ============
echo "=== [3/5] 安装 Promtail ==="

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

# ============ [4/5] 安装 Grafana ============
echo "=== [4/5] 安装 Grafana ==="

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

# ============ [5/5] 创建 Ingress（HTTPS 域名访问） ============
echo "=== [5/5] 创建 Grafana Ingress ==="

# 复用 ecom 的 ClusterIssuer（letsencrypt-prod）
# 如果 ClusterIssuer 不存在，跳过 TLS（仅 HTTP）
TLS_ENABLED=false
if ${KUBECTL} get clusterissuer letsencrypt-prod &>/dev/null; then
  TLS_ENABLED=true
  echo "检测到 ClusterIssuer letsencrypt-prod，启用自动 HTTPS"
else
  echo "警告: 未检测到 ClusterIssuer letsencrypt-prod，仅使用 HTTP"
fi

# 构建 Ingress YAML
INGRESS_YAML="apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: grafana-ingress
  namespace: ${NAMESPACE}
  annotations:"

if [[ "${TLS_ENABLED}" == "true" ]]; then
  INGRESS_YAML="${INGRESS_YAML}
    cert-manager.io/cluster-issuer: \"letsencrypt-prod\"
    nginx.ingress.kubernetes.io/ssl-redirect: \"true\""
else
  INGRESS_YAML="${INGRESS_YAML}
    nginx.ingress.kubernetes.io/ssl-redirect: \"false\""
fi

INGRESS_YAML="${INGRESS_YAML}
    nginx.ingress.kubernetes.io/configuration-snippet: |
      more_set_headers \"X-Content-Type-Options: nosniff\";
      more_set_headers \"X-Frame-Options: DENY\";
spec:
  ingressClassName: nginx"

if [[ "${TLS_ENABLED}" == "true" ]]; then
  INGRESS_YAML="${INGRESS_YAML}
  tls:
    - hosts:
        - ${GRAFANA_HOST}
      secretName: grafana-tls"
fi

INGRESS_YAML="${INGRESS_YAML}
  rules:
    - host: ${GRAFANA_HOST}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: grafana
                port:
                  number: 80"

echo "${INGRESS_YAML}" | ${KUBECTL} apply -f -

echo "Grafana Ingress 已创建: ${GRAFANA_HOST}"

if [[ "${TLS_ENABLED}" == "true" ]]; then
  echo "等待 TLS 证书签发..."
  for i in $(seq 1 12); do
    if ${KUBECTL} get secret grafana-tls -n "${NAMESPACE}" &>/dev/null; then
      echo "TLS 证书已就绪"
      break
    fi
    if [[ ${i} -eq 12 ]]; then
      echo "提示: 证书签发可能需要 1-2 分钟，可稍后检查:"
      echo "  ${KUBECTL} get certificate -n ${NAMESPACE}"
    fi
    sleep 10
  done
fi

# ============ 完成 ============
echo ""
echo "=========================================="
echo " Loki 日志栈安装完成！"
echo ""
echo " 验证："
echo "   ${KUBECTL} get pods -n ${NAMESPACE}"
echo "   ${KUBECTL} get ingress -n ${NAMESPACE}"
echo ""
if [[ "${TLS_ENABLED}" == "true" ]]; then
echo " 访问 Grafana："
echo "   https://${GRAFANA_HOST}"
else
echo " 访问 Grafana："
echo "   http://${GRAFANA_HOST}"
fi
echo "   账号: admin / ${GRAFANA_ADMIN_PASS}"
echo ""
echo " 备用（本地 port-forward）："
echo "   ${KUBECTL} -n ${NAMESPACE} port-forward svc/grafana 3001:80"
echo ""
echo " 测试日志查询（Grafana Explore → Loki）："
echo "   {namespace=\"ecom\"} | json"
echo "   {namespace=\"ecom\"} | json | traceId = \"xxx\""
echo "   {namespace=\"ecom\", service=\"order\"} | json | level = \"error\""
echo "=========================================="
