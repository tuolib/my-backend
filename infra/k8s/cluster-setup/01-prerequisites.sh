#!/usr/bin/env bash
# 01-prerequisites.sh — 所有节点（S1-S5）运行
# 安装 containerd、kubeadm、kubelet、kubectl，配置内核参数
set -euo pipefail

KUBE_VERSION="1.29"
CONTAINERD_VERSION="1.7.*"

echo "=== [1/6] 检查 root 权限 ==="
if [[ $EUID -ne 0 ]]; then
  echo "错误: 请使用 root 用户运行此脚本" >&2
  exit 1
fi

echo "=== [2/6] 禁用 swap ==="
swapoff -a
sed -i '/\sswap\s/s/^/#/' /etc/fstab
echo "swap 已禁用"

echo "=== [3/6] 加载内核模块 ==="
cat > /etc/modules-load.d/k8s.conf <<EOF
overlay
br_netfilter
EOF
modprobe overlay
modprobe br_netfilter
echo "内核模块已加载: overlay, br_netfilter"

echo "=== [4/6] 设置 sysctl 参数 ==="
cat > /etc/sysctl.d/k8s.conf <<EOF
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system
echo "sysctl 参数已生效"

echo "=== [5/6] 安装 containerd ==="
# 安装依赖
apt-get update -qq
apt-get install -y -qq apt-transport-https ca-certificates curl gnupg lsb-release

# Docker 官方 GPG key + apt 源（containerd 从 Docker 仓库安装）
# 自动检测 debian / ubuntu
DISTRO=$(. /etc/os-release && echo "$ID")
install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${DISTRO}/gpg" | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${DISTRO} \
  $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq containerd.io

# 生成默认配置并启用 SystemdCgroup
mkdir -p /etc/containerd
containerd config default > /etc/containerd/config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

systemctl restart containerd
systemctl enable containerd
echo "containerd 已安装并启用 SystemdCgroup"

echo "=== [6/6] 安装 kubeadm / kubelet / kubectl ==="
curl -fsSL "https://pkgs.k8s.io/core:/stable:/v${KUBE_VERSION}/deb/Release.key" | \
  gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v${KUBE_VERSION}/deb/ /" \
  > /etc/apt/sources.list.d/kubernetes.list

apt-get update -qq
apt-get install -y -qq kubelet kubeadm kubectl
# 锁定版本，防止意外升级
apt-mark hold kubelet kubeadm kubectl

systemctl enable kubelet
echo "kubeadm / kubelet / kubectl 已安装并锁定版本"

echo ""
echo "=========================================="
echo " 节点前置准备完成"
echo " 下一步："
echo "   - S1 节点运行: 02-init-control-plane.sh"
echo "   - S2/S3 节点运行: 03-join-control-plane.sh"
echo "   - S4/S5 节点运行: 04-join-workers.sh"
echo "=========================================="
