#!/usr/bin/env bash
# 02-join-server.sh — 追加 server 节点（仅多节点 HA 模式）
# 将当前节点作为额外的 control-plane 加入已有 k3s 集群
#
# 环境变量:
#   K3S_URL     — 首个 server 的 API 地址，如 https://10.0.0.1:6443（必须）
#   K3S_TOKEN   — 首个 server 的 node-token（必须）
#   NODE_IP     — 当前节点 IP（必须）
#   NODE_NAME   — 节点名称（可选，默认 hostname；VPS 同名时必须指定唯一值）
#   K3S_VERSION — 指定 k3s 版本（可选）
set -euo pipefail

K3S_URL="${K3S_URL:?请设置 K3S_URL（首个 server 的 API 地址）}"
K3S_TOKEN="${K3S_TOKEN:?请设置 K3S_TOKEN（node-token）}"
NODE_IP="${NODE_IP:?请设置 NODE_IP（当前节点 IP）}"
NODE_NAME="${NODE_NAME:-$(hostname)}"
K3S_VERSION="${K3S_VERSION:-}"

echo "=========================================="
echo " k3s Server Join（追加 control-plane）"
echo " K3S_URL=${K3S_URL}"
echo " NODE_IP=${NODE_IP}"
echo " NODE_NAME=${NODE_NAME}"
echo "=========================================="

# ============ [0/3] 清理旧安装 ============
echo "=== [0/3] 清理旧安装（如有） ==="

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

# ============ [1/3] 网络预检 ============
echo "=== [1/3] 网络预检 ==="

# 从 K3S_URL 提取 host 和 port
S1_HOST=$(echo "${K3S_URL}" | sed -E 's|https?://([^:]+):.*|\1|')
S1_PORT=$(echo "${K3S_URL}" | sed -E 's|https?://[^:]+:([0-9]+).*|\1|')

echo "检查到 S1 (${S1_HOST}:${S1_PORT}) 的连通性..."

# TCP 连通性检测（timeout 10s）
if command -v nc &>/dev/null; then
  if nc -z -w 10 "${S1_HOST}" "${S1_PORT}" 2>/dev/null; then
    echo "  ✓ ${S1_HOST}:${S1_PORT} 可达"
  else
    echo "  ✗ 无法连接 ${S1_HOST}:${S1_PORT}"
    echo "    请检查: 1) S1 k3s 是否运行  2) 防火墙/安全组是否开放 6443"
    exit 1
  fi
elif command -v curl &>/dev/null; then
  if curl -sk --connect-timeout 10 "${K3S_URL}/cacerts" >/dev/null 2>&1; then
    echo "  ✓ ${K3S_URL} 可达"
  else
    echo "  ✗ 无法连接 ${K3S_URL}"
    echo "    请检查: 1) S1 k3s 是否运行  2) 防火墙/安全组是否开放 6443"
    exit 1
  fi
else
  echo "  跳过连通性检测（nc/curl 均不可用）"
fi

echo "检查 etcd 端口 (${S1_HOST}:2379)..."
if command -v nc &>/dev/null; then
  if nc -z -w 10 "${S1_HOST}" 2379 2>/dev/null; then
    echo "  ✓ ${S1_HOST}:2379 可达"
  else
    echo "  ⚠ ${S1_HOST}:2379 不可达（etcd 通信可能受限）"
    echo "    多节点 HA 需要开放端口: 2379-2380, 6443, 10250"
  fi
fi

# ============ [2/3] 加入集群 ============
echo "=== [2/3] 加入集群 ==="

INSTALL_ENV="K3S_URL=${K3S_URL} K3S_TOKEN=${K3S_TOKEN}"
K3S_FLAGS=(
  "--write-kubeconfig-mode" "644"
  "--node-name" "${NODE_NAME}"
  "--node-ip" "${NODE_IP}"
  "--tls-san" "${NODE_IP}"
)

if [[ -n "${K3S_VERSION}" ]]; then
  INSTALL_ENV="INSTALL_K3S_VERSION=${K3S_VERSION} ${INSTALL_ENV}"
fi

eval "curl -sfL https://get.k3s.io | ${INSTALL_ENV} sh -s - server ${K3S_FLAGS[*]}"
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

# ============ [3/3] 验证节点 ============
echo "=== [3/3] 验证节点 ==="

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

for i in $(seq 1 60); do
  if kubectl get nodes 2>/dev/null | grep "$(hostname)" | grep -q " Ready"; then
    echo "当前节点已加入并就绪"
    kubectl get nodes -o wide
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "⚠ 节点等待超时（5 分钟），打印诊断信息："
    echo "--- k3s 服务日志（最近 30 行）---"
    journalctl -u k3s.service --no-pager -n 30 2>/dev/null || true
    exit 1
  fi
  echo "  等待节点就绪... (${i}/60)"
  sleep 5
done

echo ""
echo "=========================================="
echo " Server 节点加入完成！"
echo "=========================================="
