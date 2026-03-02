#!/usr/bin/env bash
# 01-install-server.sh — 安装首个 k3s server 节点
# 支持 single（单节点）和 multi（多节点 HA）两种模式
#
# 环境变量:
#   K3S_MODE       — single 或 multi（默认 single）
#   NODE_IP        — 当前节点公网/内网 IP（必须）
#   NODE_NAME      — 节点名称（可选，默认 hostname；VPS 同名时必须指定唯一值）
#   K3S_VIP        — VPC 内网 VIP 地址（可选，如 10.0.0.100，用于 kube-vip）
#   K3S_EXTRA_SANS — 额外的 TLS SAN，逗号分隔（可选，如域名）
#   K3S_VERSION    — 指定 k3s 版本（可选，如 v1.29.2+k3s1）
set -euo pipefail

K3S_MODE="${K3S_MODE:-single}"
NODE_IP="${NODE_IP:?请设置 NODE_IP（当前节点 IP）}"
NODE_NAME="${NODE_NAME:-$(hostname)}"
K3S_VIP="${K3S_VIP:-}"
K3S_EXTRA_SANS="${K3S_EXTRA_SANS:-}"
K3S_VERSION="${K3S_VERSION:-}"

echo "=========================================="
echo " k3s Server 安装 (mode=${K3S_MODE})"
echo " NODE_IP=${NODE_IP}"
echo " NODE_NAME=${NODE_NAME}"
[[ -n "${K3S_VIP}" ]] && echo " VIP=${K3S_VIP}"
echo "=========================================="

# ============ 基础参数 ============
K3S_FLAGS=(
  "--disable" "traefik"
  "--disable" "servicelb"
  "--write-kubeconfig-mode" "644"
  "--node-name" "${NODE_NAME}"
  "--node-ip" "${NODE_IP}"
  "--tls-san" "${NODE_IP}"
)

# 追加 VIP 到 TLS SAN（kube-vip 高可用需要）
if [[ -n "${K3S_VIP}" ]]; then
  K3S_FLAGS+=("--tls-san" "${K3S_VIP}")
  echo "VIP TLS SAN: ${K3S_VIP}"
fi

# 追加额外 SAN
if [[ -n "${K3S_EXTRA_SANS}" ]]; then
  IFS=',' read -ra SANS <<< "${K3S_EXTRA_SANS}"
  for SAN in "${SANS[@]}"; do
    K3S_FLAGS+=("--tls-san" "${SAN}")
  done
fi

# 多节点模式：启用内嵌 etcd
if [[ "${K3S_MODE}" == "multi" ]]; then
  K3S_FLAGS+=("--cluster-init")
  echo "多节点 HA 模式：启用内嵌 etcd"
fi

# ============ 安装 k3s ============
echo "=== [1/3] 安装 k3s server ==="

INSTALL_CMD="curl -sfL https://get.k3s.io | sh -s - server ${K3S_FLAGS[*]}"

if [[ -n "${K3S_VERSION}" ]]; then
  echo "指定版本: ${K3S_VERSION}"
  INSTALL_CMD="curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=${K3S_VERSION} sh -s - server ${K3S_FLAGS[*]}"
fi

eval "${INSTALL_CMD}"

# ============ 等待节点就绪 ============
echo "=== [2/3] 等待节点就绪 ==="

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

for i in $(seq 1 60); do
  if kubectl get nodes 2>/dev/null | grep -q " Ready"; then
    echo "节点已就绪"
    kubectl get nodes -o wide
    break
  fi
  echo "  等待节点就绪... (${i}/60)"
  sleep 5
done

# ============ 输出 token 信息 ============
echo "=== [3/3] 集群信息 ==="

NODE_TOKEN_PATH="/var/lib/rancher/k3s/server/node-token"
if [[ -f "${NODE_TOKEN_PATH}" ]]; then
  echo "Node Token 路径: ${NODE_TOKEN_PATH}"
  echo "Node Token 值:   $(cat "${NODE_TOKEN_PATH}")"
else
  echo "警告: 未找到 node-token 文件"
fi

echo ""
echo "=========================================="
echo " k3s Server 安装完成！"
echo ""
echo " KUBECONFIG: /etc/rancher/k3s/k3s.yaml"
echo " kubectl:    k3s kubectl get nodes"
echo ""
if [[ "${K3S_MODE}" == "multi" ]]; then
  echo " 追加 Server: 在其他节点运行 02-join-server.sh"
  echo "   K3S_URL=https://${NODE_IP}:6443"
  echo "   K3S_TOKEN=$(cat "${NODE_TOKEN_PATH}" 2>/dev/null || echo '<见上方>')"
fi
echo " 追加 Agent:  在 worker 节点运行 03-join-agent.sh"
echo "   K3S_URL=https://${NODE_IP}:6443"
echo "   K3S_TOKEN=$(cat "${NODE_TOKEN_PATH}" 2>/dev/null || echo '<见上方>')"
echo "=========================================="
