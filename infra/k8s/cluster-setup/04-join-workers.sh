#!/usr/bin/env bash
# 04-join-workers.sh — 在 S4 和 S5 节点运行
# 将节点加入为 Worker
set -euo pipefail

# ============ 配置区域（部署前必须修改） ============
KUBE_VIP_ADDRESS="${KUBE_VIP_ADDRESS:?请设置 KUBE_VIP_ADDRESS 环境变量}"
JOIN_TOKEN="${JOIN_TOKEN:?请设置 JOIN_TOKEN（从 S1 的 kubeadm token create --print-join-command 获取）}"
DISCOVERY_HASH="${DISCOVERY_HASH:?请设置 DISCOVERY_HASH（从 S1 的 kubeadm token create --print-join-command 获取）}"
# ==================================================

echo "=== [1/2] 检查 root 权限 ==="
if [[ $EUID -ne 0 ]]; then
  echo "错误: 请使用 root 用户运行此脚本" >&2
  exit 1
fi

echo "=== [2/2] 加入 Worker ==="
kubeadm join "${KUBE_VIP_ADDRESS}:6443" \
  --token "${JOIN_TOKEN}" \
  --discovery-token-ca-cert-hash "${DISCOVERY_HASH}"

echo ""
echo "=========================================="
echo " Worker 节点加入成功！"
echo ""
echo " 在 S1 上运行以下命令验证："
echo "   kubectl get nodes"
echo "=========================================="
