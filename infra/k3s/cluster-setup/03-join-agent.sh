#!/usr/bin/env bash
# 03-join-agent.sh — 追加 agent/worker 节点（仅多节点模式）
# 将当前节点作为 worker 加入已有 k3s 集群
#
# 环境变量:
#   K3S_URL     — server 的 API 地址，如 https://10.0.0.1:6443（必须）
#   K3S_TOKEN   — server 的 node-token（必须）
#   NODE_IP     — 当前节点 IP（必须）
#   NODE_NAME   — 节点名称（可选，默认基于 IP 末段自动生成，如 agent-104）
#   K3S_VERSION — 指定 k3s 版本（可选）
set -euo pipefail

K3S_URL="${K3S_URL:?请设置 K3S_URL（server 的 API 地址）}"
K3S_TOKEN="${K3S_TOKEN:?请设置 K3S_TOKEN（node-token）}"
NODE_IP="${NODE_IP:?请设置 NODE_IP（当前节点 IP）}"
K3S_VERSION="${K3S_VERSION:-}"

# 自动生成唯一节点名：如果未指定 NODE_NAME，用 IP 末两段生成
# 例如 NODE_IP=10.0.0.104 → agent-0-104
if [[ -n "${NODE_NAME:-}" ]]; then
  : # 用户已指定，保持不变
else
  IP_SUFFIX=$(echo "${NODE_IP}" | awk -F. '{print $(NF-1)"-"$NF}')
  NODE_NAME="agent-${IP_SUFFIX}"
fi

echo "=========================================="
echo " k3s Agent Join（worker 节点）"
echo " K3S_URL=${K3S_URL}"
echo " NODE_IP=${NODE_IP}"
echo " NODE_NAME=${NODE_NAME}"
echo "=========================================="

# ============ [0/3] 清理旧安装 ============
echo "=== [0/3] 清理旧安装（如有） ==="

if [ -x /usr/local/bin/k3s-agent-uninstall.sh ]; then
  echo "发现旧 k3s-agent 安装，正在卸载..."
  /usr/local/bin/k3s-agent-uninstall.sh || true
  echo "旧安装已清理"
elif systemctl is-active --quiet k3s-agent 2>/dev/null; then
  echo "发现 k3s-agent 服务正在运行，先停止..."
  systemctl stop k3s-agent || true
  systemctl disable k3s-agent || true
fi

# 清理残留数据和节点密码（防止 "Node password rejected" 错误）
if [ -d /var/lib/rancher/k3s/agent ]; then
  echo "清理残留数据目录 /var/lib/rancher/k3s/agent ..."
  rm -rf /var/lib/rancher/k3s/agent
fi
if [ -f /etc/rancher/node/password ]; then
  echo "清理旧节点密码 /etc/rancher/node/password ..."
  rm -f /etc/rancher/node/password
fi

# ============ [1/3] 网络预检 ============
echo "=== [1/3] 网络预检 ==="

S1_HOST=$(echo "${K3S_URL}" | sed -E 's|https?://([^:]+):.*|\1|')
S1_PORT=$(echo "${K3S_URL}" | sed -E 's|https?://[^:]+:([0-9]+).*|\1|')

echo "检查到 Server (${S1_HOST}:${S1_PORT}) 的连通性..."

if command -v nc &>/dev/null; then
  if nc -z -w 10 "${S1_HOST}" "${S1_PORT}" 2>/dev/null; then
    echo "  OK ${S1_HOST}:${S1_PORT} 可达"
  else
    echo "  FAIL 无法连接 ${S1_HOST}:${S1_PORT}"
    echo "    请检查: 1) Server k3s 是否运行  2) 防火墙/安全组是否开放 ${S1_PORT}"
    exit 1
  fi
elif command -v curl &>/dev/null; then
  if curl -sk --connect-timeout 10 "${K3S_URL}/cacerts" >/dev/null 2>&1; then
    echo "  OK ${K3S_URL} 可达"
  else
    echo "  FAIL 无法连接 ${K3S_URL}"
    echo "    请检查: 1) Server k3s 是否运行  2) 防火墙/安全组是否开放 ${S1_PORT}"
    exit 1
  fi
else
  echo "  跳过连通性检测（nc/curl 均不可用）"
fi

# ============ [2/3] 加入集群 ============
echo "=== [2/3] 加入集群 ==="

# 修复 systemd-resolved 兼容问题（同 01-install-server.sh）
mkdir -p /etc/rancher/k3s
if [[ ! -f /etc/rancher/k3s/resolv.conf ]]; then
  cat > /etc/rancher/k3s/resolv.conf <<DNSEOF
nameserver 8.8.8.8
nameserver 1.1.1.1
DNSEOF
  echo "已创建 /etc/rancher/k3s/resolv.conf（公共 DNS）"
fi

INSTALL_ENV="K3S_URL=${K3S_URL} K3S_TOKEN=${K3S_TOKEN}"
K3S_FLAGS=(
  "--node-name" "${NODE_NAME}"
  "--node-ip" "${NODE_IP}"
  "--resolv-conf" "/etc/rancher/k3s/resolv.conf"
)

if [[ -n "${K3S_VERSION}" ]]; then
  INSTALL_ENV="INSTALL_K3S_VERSION=${K3S_VERSION} ${INSTALL_ENV}"
fi

eval "curl -sfL https://get.k3s.io | ${INSTALL_ENV} sh -s - agent ${K3S_FLAGS[*]}"

# ============ [3/3] 验证 ============
echo "=== [3/3] 验证 ==="

# Agent 节点没有 kubeconfig，等待 k3s-agent 服务运行即可
for i in $(seq 1 30); do
  if systemctl is-active --quiet k3s-agent; then
    echo "k3s-agent 服务已运行"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "WARNING 等待超时（150 秒），打印诊断信息："
    echo "--- k3s-agent 服务日志（最近 30 行）---"
    journalctl -u k3s-agent --no-pager -n 30 2>/dev/null || true
    echo "--- systemd 服务状态 ---"
    systemctl status k3s-agent --no-pager 2>/dev/null || true
    exit 1
  fi
  echo "  等待 k3s-agent 启动... (${i}/30)"
  sleep 5
done

echo ""
echo "=========================================="
echo " Agent 节点加入完成！"
echo " NODE_NAME=${NODE_NAME}"
echo " 在 server 节点验证: k3s kubectl get nodes"
echo "=========================================="
