#!/usr/bin/env bash
# 05-install-cni.sh — 仅在 S1 节点运行（集群初始化后）
# 安装 Calico CNI 网络插件
set -euo pipefail

CALICO_VERSION="v3.27.0"

echo "=== [1/2] 检查集群连通性 ==="
if ! kubectl get nodes &>/dev/null; then
  echo "错误: 无法连接到 K8s 集群，请确认 kubeconfig 已配置" >&2
  exit 1
fi

echo "=== [2/2] 安装 Calico CNI ==="
# 安装 Calico Operator
kubectl create -f "https://raw.githubusercontent.com/projectcalico/calico/${CALICO_VERSION}/manifests/tigera-operator.yaml" || true

# 安装 Calico 自定义资源（使用 kubeadm-config 中的 podSubnet）
cat <<EOF | kubectl apply -f -
apiVersion: operator.tigera.io/v1
kind: Installation
metadata:
  name: default
spec:
  calicoNetwork:
    ipPools:
    - name: default-ipv4-ippool
      blockSize: 26
      cidr: 10.244.0.0/16
      encapsulation: VXLANCrossSubnet
      natOutgoing: Enabled
      nodeSelector: all()
---
apiVersion: operator.tigera.io/v1
kind: APIServer
metadata:
  name: default
spec: {}
EOF

echo "等待 Calico Pod 就绪..."
kubectl wait --for=condition=Available --timeout=120s tigerastatus/calico || {
  echo "警告: Calico 尚未完全就绪，请手动检查:"
  echo "  kubectl get pods -n calico-system"
}

echo ""
echo "=========================================="
echo " Calico CNI 安装完成"
echo ""
echo " 验证节点状态："
echo "   kubectl get nodes（所有节点应为 Ready）"
echo ""
echo " 下一步："
echo "   运行 06-install-operators.sh"
echo "=========================================="
