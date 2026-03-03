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
# 所有参数均可自动检测，也可通过环境变量覆盖:
#   K3S_MODE — 自动按节点数判断 single/multi
#   K3S_VIP  — 自动从 k3s --tls-san 中提取非节点 IP
#   K3S_VIP_INTERFACE — 自动取默认路由网卡
#   S1_NODE~S5_NODE — 节点名（默认 s1~s5）
set -euo pipefail

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

# ============ 自动检测参数 ============

# K3S_MODE: 按节点数自动判断
if [[ -z "${K3S_MODE:-}" ]]; then
  NODE_COUNT=$(${KUBECTL} get nodes --no-headers | wc -l)
  if [[ ${NODE_COUNT} -gt 1 ]]; then
    K3S_MODE="multi"
  else
    K3S_MODE="single"
  fi
  echo "自动检测: K3S_MODE=${K3S_MODE} (${NODE_COUNT} 个节点)"
fi

# K3S_VIP: 从 k3s service 的 --tls-san 中找出非节点 IP（即 VIP）
if [[ -z "${K3S_VIP:-}" ]]; then
  NODE_IPS=$(${KUBECTL} get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}')
  ALL_SANS=$(grep -oP '(?<=--tls-san )\S+' /etc/systemd/system/k3s.service 2>/dev/null || true)
  for SAN in ${ALL_SANS}; do
    # 只匹配 IP 格式，排除节点自身 IP
    if [[ "${SAN}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && ! echo " ${NODE_IPS} " | grep -q " ${SAN} "; then
      K3S_VIP="${SAN}"
      echo "自动检测: K3S_VIP=${K3S_VIP} (from k3s --tls-san)"
      break
    fi
  done
  K3S_VIP="${K3S_VIP:-}"
fi

# K3S_VIP_INTERFACE: 取默认路由网卡
if [[ -z "${K3S_VIP_INTERFACE:-}" ]] && [[ -n "${K3S_VIP}" ]]; then
  K3S_VIP_INTERFACE=$(ip route show default 2>/dev/null | awk '{print $5; exit}')
  K3S_VIP_INTERFACE="${K3S_VIP_INTERFACE:-eth1}"
  echo "自动检测: K3S_VIP_INTERFACE=${K3S_VIP_INTERFACE}"
else
  K3S_VIP_INTERFACE="${K3S_VIP_INTERFACE:-eth1}"
fi

# ============ Operator 版本（与 k8s 保持一致） ============
CNPG_VERSION="1.22.1"
REDIS_OPERATOR_VERSION="0.18.0"
INGRESS_NGINX_VERSION="4.9.1"
CERT_MANAGER_VERSION="v1.14.3"
KUBE_VIP_VERSION="v0.8.7"

echo "=========================================="
echo " k3s Operator 安装 (mode=${K3S_MODE})"
[[ -n "${K3S_VIP}" ]] && echo " VIP=${K3S_VIP} (interface=${K3S_VIP_INTERFACE})"
echo "=========================================="

# ============ [1/7] 检查集群连通性 ============
echo "=== [1/7] 检查集群连通性 ==="
echo "集群连通正常"
${KUBECTL} get nodes -o wide

# ============ [2/7] 检查/安装 Helm ============
echo "=== [2/7] 检查/安装 Helm ==="

if ! command -v helm &>/dev/null; then
  echo "Helm 未安装，正在安装..."
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi

helm version --short
echo "Helm 就绪"

# ============ [3/7] 节点标签（仅多节点模式） ============
echo "=== [3/7] 节点标签 ==="

if [[ "${K3S_MODE}" == "multi" ]]; then
  # 自动从集群获取节点名（安装时通过 --node-name 固定为 s1-s5）
  S1_NODE="${S1_NODE:-s1}"
  S2_NODE="${S2_NODE:-s2}"
  S3_NODE="${S3_NODE:-s3}"
  S4_NODE="${S4_NODE:-s4}"
  S5_NODE="${S5_NODE:-s5}"

  echo "节点映射: S1=${S1_NODE} S2=${S2_NODE} S3=${S3_NODE} S4=${S4_NODE} S5=${S5_NODE}"

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

# ============ [4/7] 安装 kube-vip（VPC VIP 高可用） ============
echo "=== [4/7] 安装 kube-vip ==="

if [[ -n "${K3S_VIP}" ]]; then
  echo "安装 kube-vip ${KUBE_VIP_VERSION}（VIP=${K3S_VIP}, interface=${K3S_VIP_INTERFACE}）..."

  # 安装 RBAC
  ${KUBECTL} apply -f https://kube-vip.io/manifests/rbac.yaml

  # 创建 kube-vip DaemonSet（仅运行在 control-plane 节点）
  cat <<KVEOF | ${KUBECTL} apply -f -
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: kube-vip-ds
  namespace: kube-system
  labels:
    app.kubernetes.io/name: kube-vip-ds
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: kube-vip-ds
  template:
    metadata:
      labels:
        app.kubernetes.io/name: kube-vip-ds
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: node-role.kubernetes.io/master
                operator: Exists
            - matchExpressions:
              - key: node-role.kubernetes.io/control-plane
                operator: Exists
      tolerations:
      - effect: NoSchedule
        operator: Exists
      - effect: NoExecute
        operator: Exists
      containers:
      - name: kube-vip
        image: ghcr.io/kube-vip/kube-vip:${KUBE_VIP_VERSION}
        args:
        - manager
        env:
        - name: vip_arp
          value: "true"
        - name: port
          value: "6443"
        - name: vip_interface
          value: "${K3S_VIP_INTERFACE}"
        - name: vip_address
          value: "${K3S_VIP}"
        - name: cp_enable
          value: "true"
        - name: cp_namespace
          value: kube-system
        - name: svc_enable
          value: "true"
        - name: svc_leasename
          value: plndr-svcs-lock
        - name: vip_leaderelection
          value: "true"
        - name: vip_leasename
          value: plndr-cp-lock
        - name: vip_leaseduration
          value: "5"
        - name: vip_renewdeadline
          value: "3"
        - name: vip_retryperiod
          value: "1"
        - name: address
          value: "${K3S_VIP}"
        securityContext:
          capabilities:
            add:
            - NET_ADMIN
            - NET_RAW
      hostNetwork: true
      serviceAccountName: kube-vip
KVEOF

  echo "等待 kube-vip 就绪..."
  ${KUBECTL} wait --for=condition=Ready --timeout=60s \
    pod -l app.kubernetes.io/name=kube-vip-ds -n kube-system || {
    echo "警告: kube-vip 尚未就绪，请手动检查:"
    echo "  ${KUBECTL} get pods -n kube-system -l app.kubernetes.io/name=kube-vip-ds"
    echo "  ${KUBECTL} describe pods -n kube-system -l app.kubernetes.io/name=kube-vip-ds"
  }

  echo "kube-vip 已安装（VIP=${K3S_VIP}）"
else
  echo "未设置 K3S_VIP，跳过 kube-vip 安装"
  echo "  如需 VIP 高可用，请设置环境变量 K3S_VIP 和 K3S_VIP_INTERFACE"
fi

# ============ [4.5/7] 修复 CoreDNS 外部域名解析 ============
echo "=== [4.5/7] 修复 CoreDNS 外部域名解析 ==="

# Ubuntu 22.04 使用 systemd-resolved（127.0.0.53），Pod 网络内不可达
# 将 CoreDNS 上游 DNS 从 /etc/resolv.conf 改为公共 DNS 服务器
CURRENT_FORWARD=$(${KUBECTL} get configmap coredns -n kube-system -o jsonpath='{.data.Corefile}' 2>/dev/null | grep -o 'forward \. .*' || true)
echo "当前 CoreDNS forward 配置: ${CURRENT_FORWARD:-未找到}"

if echo "${CURRENT_FORWARD}" | grep -q '/etc/resolv.conf'; then
  echo "检测到 CoreDNS 使用 /etc/resolv.conf（systemd-resolved 不兼容），修改为公共 DNS..."
  COREFILE=$(${KUBECTL} get configmap coredns -n kube-system -o jsonpath='{.data.Corefile}')
  NEW_COREFILE=$(echo "${COREFILE}" | sed 's|forward \. /etc/resolv.conf|forward . 8.8.8.8 1.1.1.1|')
  ${KUBECTL} get configmap coredns -n kube-system -o json | \
    jq --arg cf "${NEW_COREFILE}" '.data.Corefile = $cf' | \
    ${KUBECTL} apply -f -
  # 重启 CoreDNS 使配置生效
  ${KUBECTL} rollout restart deployment/coredns -n kube-system
  ${KUBECTL} rollout status deployment/coredns -n kube-system --timeout=60s
  echo "CoreDNS 已更新为使用公共 DNS (8.8.8.8, 1.1.1.1)"
else
  echo "CoreDNS 未使用 /etc/resolv.conf，跳过修复"
fi

# ============ [5/7] 验证 local-path-provisioner（k3s 内置） ============
echo "=== [5/7] 验证 StorageClass ==="

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

# ============ [6/7] 安装 CloudNativePG + Redis Operator ============
echo "=== [6/7] 安装 CloudNativePG + Redis Operator ==="

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

# Redis Operator CRDs（使用 --server-side 避免注解大小限制）
echo "安装 Redis Operator CRDs..."
${KUBECTL} apply --server-side -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redis.yaml"
${KUBECTL} apply --server-side -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redisclusters.yaml"
${KUBECTL} apply --server-side -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redisreplications.yaml"
${KUBECTL} apply --server-side -f "https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/v${REDIS_OPERATOR_VERSION}/config/crd/bases/redis.redis.opstreelabs.in_redissentinels.yaml"

# Redis Operator (Helm)
echo "安装 Redis Operator..."
helm repo add ot-helm https://ot-container-kit.github.io/helm-charts/ || true
helm repo update
helm upgrade --install redis-operator ot-helm/redis-operator \
  --namespace redis-operator-system --create-namespace \
  --version "${REDIS_OPERATOR_VERSION}" \
  --wait --timeout 120s

echo "CloudNativePG + Redis Operator 已安装"

# ============ [7/7] 安装 Nginx Ingress Controller + cert-manager ============
echo "=== [7/7] 安装 Nginx Ingress Controller + cert-manager ==="

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
  --set controller.admissionWebhooks.enabled=false
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
