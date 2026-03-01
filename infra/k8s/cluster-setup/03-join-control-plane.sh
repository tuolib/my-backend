#!/usr/bin/env bash
# 03-join-control-plane.sh — 在 S2 和 S3 节点运行
# 将节点加入为 Control Plane 成员
set -euo pipefail

# ============ 配置区域（部署前必须修改） ============
KUBE_VIP_ADDRESS="${KUBE_VIP_ADDRESS:?请设置 KUBE_VIP_ADDRESS 环境变量}"
KUBE_VIP_INTERFACE="${KUBE_VIP_INTERFACE:-eth0}"
JOIN_TOKEN="${JOIN_TOKEN:?请设置 JOIN_TOKEN（从 S1 的 kubeadm token create --print-join-command 获取）}"
DISCOVERY_HASH="${DISCOVERY_HASH:?请设置 DISCOVERY_HASH（从 S1 的 kubeadm token create --print-join-command 获取）}"
CERTIFICATE_KEY="${CERTIFICATE_KEY:?请设置 CERTIFICATE_KEY（从 S1 的 kubeadm init phase upload-certs --upload-certs 获取）}"
# ==================================================

echo "=== [1/3] 检查 root 权限 ==="
if [[ $EUID -ne 0 ]]; then
  echo "错误: 请使用 root 用户运行此脚本" >&2
  exit 1
fi

echo "=== [2/3] 安装 kube-vip 静态 Pod ==="
# kube-vip 需要在每个 Control Plane 节点上安装
KVVERSION="v0.7.2"
mkdir -p /etc/kubernetes/manifests

ctr image pull "ghcr.io/kube-vip/kube-vip:${KVVERSION}"
ctr run --rm --net-host "ghcr.io/kube-vip/kube-vip:${KVVERSION}" vip \
  /kube-vip manifest pod \
  --interface "${KUBE_VIP_INTERFACE}" \
  --address "${KUBE_VIP_ADDRESS}" \
  --controlplane \
  --arp \
  --leaderElection > /etc/kubernetes/manifests/kube-vip.yaml

echo "kube-vip 静态 Pod manifest 已生成"

echo "=== [3/3] 加入 Control Plane ==="
kubeadm join "${KUBE_VIP_ADDRESS}:6443" \
  --token "${JOIN_TOKEN}" \
  --discovery-token-ca-cert-hash "${DISCOVERY_HASH}" \
  --control-plane \
  --certificate-key "${CERTIFICATE_KEY}"

# 配置 kubectl
mkdir -p "$HOME/.kube"
cp /etc/kubernetes/admin.conf "$HOME/.kube/config"
chown "$(id -u):$(id -g)" "$HOME/.kube/config"

echo ""
echo "=========================================="
echo " Control Plane 节点加入成功！"
echo ""
echo " 在 S1 上运行以下命令验证："
echo "   kubectl get nodes"
echo "=========================================="
