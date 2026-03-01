#!/usr/bin/env bash
# 02-init-control-plane.sh — 仅在 S1 节点运行
# 初始化第一个 Control Plane 节点，安装 kube-vip
set -euo pipefail

# ============ 配置区域（部署前必须修改） ============
KUBE_VIP_ADDRESS="${KUBE_VIP_ADDRESS:?请设置 KUBE_VIP_ADDRESS 环境变量}"
KUBE_VIP_INTERFACE="${KUBE_VIP_INTERFACE:-eth0}"
S1_IP="${S1_IP:?请设置 S1_IP 环境变量}"
S2_IP="${S2_IP:-}"
S3_IP="${S3_IP:-}"
# ==================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== [1/4] 检查 root 权限 ==="
if [[ $EUID -ne 0 ]]; then
  echo "错误: 请使用 root 用户运行此脚本" >&2
  exit 1
fi

echo "=== [2/4] 安装 kube-vip 静态 Pod ==="
# kube-vip 以 Static Pod 方式在所有 Control Plane 节点运行
# 通过 ARP 实现 VIP 漂移
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

echo "=== [3/4] 更新 kubeadm-config 并初始化集群 ==="
# 替换配置文件中的占位符
CONFIG_FILE="${SCRIPT_DIR}/kubeadm-config.yaml"
TEMP_CONFIG="/tmp/kubeadm-config-rendered.yaml"
sed \
  -e "s|KUBE_VIP_ADDRESS|${KUBE_VIP_ADDRESS}|g" \
  -e "s|S1_IP|${S1_IP}|g" \
  -e "s|S2_IP|${S2_IP}|g" \
  -e "s|S3_IP|${S3_IP}|g" \
  "${CONFIG_FILE}" > "${TEMP_CONFIG}"

kubeadm init \
  --config "${TEMP_CONFIG}" \
  --upload-certs

echo "=== [4/4] 配置 kubectl ==="
mkdir -p "$HOME/.kube"
cp /etc/kubernetes/admin.conf "$HOME/.kube/config"
chown "$(id -u):$(id -g)" "$HOME/.kube/config"

echo ""
echo "=========================================="
echo " Control Plane 初始化完成！"
echo ""
echo " 保存以下信息用于其他节点加入集群："
echo ""
echo " 1) Control Plane 加入命令（S2/S3 使用）："
echo "    kubeadm token create --print-join-command"
echo "    kubeadm init phase upload-certs --upload-certs"
echo ""
echo " 2) Worker 加入命令（S4/S5 使用）："
echo "    kubeadm token create --print-join-command"
echo ""
echo " 下一步："
echo "   - S2/S3: 运行 03-join-control-plane.sh"
echo "   - 完成后运行 05-install-cni.sh"
echo "=========================================="
