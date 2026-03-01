#!/usr/bin/env bash
# 03-join-agent.sh — 追加 agent/worker 节点（仅多节点模式）
# 将当前节点作为 worker 加入已有 k3s 集群
#
# 环境变量:
#   K3S_URL     — server 的 API 地址，如 https://10.0.0.1:6443（必须）
#   K3S_TOKEN   — server 的 node-token（必须）
#   NODE_IP     — 当前节点 IP（必须）
#   K3S_VERSION — 指定 k3s 版本（可选）
set -euo pipefail

K3S_URL="${K3S_URL:?请设置 K3S_URL（server 的 API 地址）}"
K3S_TOKEN="${K3S_TOKEN:?请设置 K3S_TOKEN（node-token）}"
NODE_IP="${NODE_IP:?请设置 NODE_IP（当前节点 IP）}"
K3S_VERSION="${K3S_VERSION:-}"

echo "=========================================="
echo " k3s Agent Join（worker 节点）"
echo " K3S_URL=${K3S_URL}"
echo " NODE_IP=${NODE_IP}"
echo "=========================================="

echo "=== [1/2] 加入集群 ==="

INSTALL_ENV="K3S_URL=${K3S_URL} K3S_TOKEN=${K3S_TOKEN}"
K3S_FLAGS=(
  "--node-ip" "${NODE_IP}"
)

if [[ -n "${K3S_VERSION}" ]]; then
  INSTALL_ENV="INSTALL_K3S_VERSION=${K3S_VERSION} ${INSTALL_ENV}"
fi

eval "curl -sfL https://get.k3s.io | ${INSTALL_ENV} sh -s - agent ${K3S_FLAGS[*]}"

echo "=== [2/2] 验证 ==="

# Agent 节点没有 kubeconfig，等待 k3s-agent 服务运行即可
for i in $(seq 1 30); do
  if systemctl is-active --quiet k3s-agent; then
    echo "k3s-agent 服务已运行"
    break
  fi
  echo "  等待 k3s-agent 启动... (${i}/30)"
  sleep 5
done

echo ""
echo "=========================================="
echo " Agent 节点加入完成！"
echo " 在 server 节点验证: k3s kubectl get nodes"
echo "=========================================="
