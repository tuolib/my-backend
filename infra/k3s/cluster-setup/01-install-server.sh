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
# 自动生成唯一节点名：如果未指定 NODE_NAME，用 IP 末两段生成
if [[ -n "${NODE_NAME:-}" ]]; then
  : # 用户已指定，保持不变
else
  IP_SUFFIX=$(echo "${NODE_IP}" | awk -F. '{print $(NF-1)"-"$NF}')
  NODE_NAME="server-${IP_SUFFIX}"
fi
K3S_VIP="${K3S_VIP:-}"
K3S_EXTRA_SANS="${K3S_EXTRA_SANS:-}"
K3S_VERSION="${K3S_VERSION:-}"

echo "=========================================="
echo " k3s Server 安装 (mode=${K3S_MODE})"
echo " NODE_IP=${NODE_IP}"
echo " NODE_NAME=${NODE_NAME}"
[[ -n "${K3S_VIP}" ]] && echo " VIP=${K3S_VIP}"
echo "=========================================="

# ============ [0/4] 清理旧安装 ============
echo "=== [0/4] 清理旧安装（如有） ==="

if [ -x /usr/local/bin/k3s-uninstall.sh ]; then
  echo "发现旧 k3s 安装，正在卸载..."
  /usr/local/bin/k3s-uninstall.sh || true
  echo "旧安装已清理"
elif systemctl is-active --quiet k3s 2>/dev/null; then
  echo "发现 k3s 服务正在运行，先停止..."
  systemctl stop k3s || true
  systemctl disable k3s || true
fi

# 清理残留数据目录（防止 etcd 状态冲突）
if [ -d /var/lib/rancher/k3s ]; then
  echo "清理残留数据目录 /var/lib/rancher/k3s ..."
  rm -rf /var/lib/rancher/k3s
fi

# ============ [1/4] 基础参数 ============
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

# ============ [2/4] 安装 k3s ============
echo "=== [2/4] 安装 k3s server ==="

INSTALL_CMD="curl -sfL https://get.k3s.io | sh -s - server ${K3S_FLAGS[*]}"

if [[ -n "${K3S_VERSION}" ]]; then
  echo "指定版本: ${K3S_VERSION}"
  INSTALL_CMD="curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=${K3S_VERSION} sh -s - server ${K3S_FLAGS[*]}"
fi

eval "${INSTALL_CMD}"
INSTALL_EXIT=$?

if [ $INSTALL_EXIT -ne 0 ]; then
  echo ""
  echo "=========================================="
  echo " ✗ k3s 安装失败 (exit code: ${INSTALL_EXIT})"
  echo "=========================================="
  echo ""
  echo "--- k3s 服务日志（最近 50 行）---"
  journalctl -u k3s.service --no-pager -n 50 2>/dev/null || echo "(无法读取日志)"
  echo ""
  echo "--- systemd 服务状态 ---"
  systemctl status k3s.service --no-pager 2>/dev/null || true
  exit $INSTALL_EXIT
fi

# 确保服务已启动（installer 可能因 "no change detected" 跳过启动）
if ! systemctl is-active --quiet k3s; then
  echo "k3s 服务未运行，手动启动..."
  systemctl start k3s
  sleep 3
  if ! systemctl is-active --quiet k3s; then
    echo ""
    echo "=========================================="
    echo " ✗ k3s 服务启动失败"
    echo "=========================================="
    echo ""
    echo "--- k3s 服务日志（最近 50 行）---"
    journalctl -u k3s.service --no-pager -n 50 2>/dev/null || echo "(无法读取日志)"
    echo ""
    echo "--- systemd 服务状态 ---"
    systemctl status k3s.service --no-pager 2>/dev/null || true
    exit 1
  fi
fi

# ============ [3/4] 等待节点就绪 ============
echo "=== [3/4] 等待节点就绪 ==="

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

for i in $(seq 1 60); do
  if kubectl get nodes 2>/dev/null | grep "${NODE_NAME}" | grep -q " Ready"; then
    echo "节点已就绪"
    kubectl get nodes -o wide
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "⚠ 节点等待超时（5 分钟），打印诊断信息："
    echo ""
    echo "--- kubectl get nodes ---"
    kubectl get nodes -o wide 2>/dev/null || echo "(kubectl 不可用)"
    echo ""
    echo "--- k3s 服务日志（最近 30 行）---"
    journalctl -u k3s.service --no-pager -n 30 2>/dev/null || true
    echo ""
    echo "--- systemd 服务状态 ---"
    systemctl status k3s.service --no-pager 2>/dev/null || true
    exit 1
  fi
  echo "  等待节点就绪... (${i}/60)"
  sleep 5
done

# ============ [4/4] 输出 token 信息 ============
echo "=== [4/4] 集群信息 ==="

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
