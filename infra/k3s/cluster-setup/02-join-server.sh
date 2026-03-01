#!/usr/bin/env bash
# 02-join-server.sh — 追加 server 节点（仅多节点 HA 模式）
# 将当前节点作为额外的 control-plane 加入已有 k3s 集群
#
# 环境变量:
#   K3S_URL     — 首个 server 的 API 地址，如 https://10.0.0.1:6443（必须）
#   K3S_TOKEN   — 首个 server 的 node-token（必须）
#   NODE_IP     — 当前节点 IP（必须）
#   K3S_VERSION — 指定 k3s 版本（可选）
set -euo pipefail

K3S_URL="${K3S_URL:?请设置 K3S_URL（首个 server 的 API 地址）}"
K3S_TOKEN="${K3S_TOKEN:?请设置 K3S_TOKEN（node-token）}"
NODE_IP="${NODE_IP:?请设置 NODE_IP（当前节点 IP）}"
K3S_VERSION="${K3S_VERSION:-}"

echo "=========================================="
echo " k3s Server Join（追加 control-plane）"
echo " K3S_URL=${K3S_URL}"
echo " NODE_IP=${NODE_IP}"
echo "=========================================="

echo "=== [1/2] 加入集群 ==="

INSTALL_ENV="K3S_URL=${K3S_URL} K3S_TOKEN=${K3S_TOKEN}"
K3S_FLAGS=(
  "--disable" "traefik"
  "--disable" "servicelb"
  "--write-kubeconfig-mode" "644"
  "--node-ip" "${NODE_IP}"
  "--tls-san" "${NODE_IP}"
)

if [[ -n "${K3S_VERSION}" ]]; then
  INSTALL_ENV="INSTALL_K3S_VERSION=${K3S_VERSION} ${INSTALL_ENV}"
fi

eval "curl -sfL https://get.k3s.io | ${INSTALL_ENV} sh -s - server ${K3S_FLAGS[*]}"

echo "=== [2/2] 验证节点 ==="

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

for i in $(seq 1 60); do
  if kubectl get nodes 2>/dev/null | grep "$(hostname)" | grep -q " Ready"; then
    echo "当前节点已加入并就绪"
    kubectl get nodes -o wide
    break
  fi
  echo "  等待节点就绪... (${i}/60)"
  sleep 5
done

echo ""
echo "=========================================="
echo " Server 节点加入完成！"
echo "=========================================="
