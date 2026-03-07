#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# init-node.sh — 一键初始化 Swarm 集群
# ═══════════════════════════════════════════════════════════════
#
# 只需 SSH 到 S1，一条命令搞定 5 台:
#
#   bash init-node.sh <S1-IP> <S2-IP> <S3-IP> <S4-IP> <S5-IP>
#
# 前提: S1 能免密 SSH 到 S2-S5（Vultr 创建时用同一个 SSH Key 即可）

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
info() { echo -e "${YELLOW}[..]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*"; exit 1; }

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

# ── 在目标机器上执行命令 ──
run_remote() {
  local IP="$1"; shift
  ssh ${SSH_OPTS} root@"${IP}" "$@"
}

# ── 安装 Docker + 防火墙（本地或远程通用） ──
node_setup_script() {
  cat <<'SCRIPT'
set -e
# Docker
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

# Firewall
apt-get update -qq && apt-get install -y -qq ufw >/dev/null 2>&1 || true
ufw --force reset >/dev/null 2>&1
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 2377/tcp >/dev/null
ufw allow 7946/tcp >/dev/null
ufw allow 7946/udp >/dev/null
ufw allow 4789/udp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
echo "NODE_READY"
SCRIPT
}

# ═══ main ═══

[ $# -ge 1 ] || err "Usage: bash $0 <S1-IP> <S2-IP> <S3-IP> <S4-IP> <S5-IP>"

S1="${1:?}"; S2="${2:-}"; S3="${3:-}"; S4="${4:-}"; S5="${5:-}"
ALL_NODES=("${S1}" ${S2:+"${S2}"} ${S3:+"${S3}"} ${S4:+"${S4}"} ${S5:+"${S5}"})
REMOTE_NODES=(${S2:+"${S2}"} ${S3:+"${S3}"} ${S4:+"${S4}"} ${S5:+"${S5}"})

echo ""
echo "════════════════════════════════════════════"
echo "  Swarm Cluster Setup"
echo "  S1=${S1}  S2=${S2:-n/a}  S3=${S3:-n/a}  S4=${S4:-n/a}  S5=${S5:-n/a}"
echo "════════════════════════════════════════════"
echo ""

# ── 1. 所有节点: 安装 Docker + 防火墙 ──
info "Step 1/3: Installing Docker & firewall on all nodes..."

# S1 本地
info "  Setting up ${S1} (local)..."
bash -c "$(node_setup_script)" && ok "  ${S1} ready"

# S2-S5 并行
PIDS=()
for IP in "${REMOTE_NODES[@]}"; do
  info "  Setting up ${IP}..."
  (run_remote "${IP}" "bash -s" <<< "$(node_setup_script)" && ok "  ${IP} ready") &
  PIDS+=($!)
done
for PID in "${PIDS[@]}"; do wait "${PID}" || err "A remote node failed"; done

# ── 2. S1 初始化 Swarm ──
info "Step 2/3: Initializing Swarm on ${S1}..."
if docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "active"; then
  ok "Swarm already active"
else
  docker swarm init --advertise-addr "${S1}"
  ok "Swarm initialized"
fi

MGR_TOKEN=$(docker swarm join-token -q manager)
WKR_TOKEN=$(docker swarm join-token -q worker)

# ── 3. 其他节点加入 Swarm ──
info "Step 3/3: Joining nodes to Swarm..."

join_node() {
  local IP="$1" TOKEN="$2" ROLE="$3"
  # 跳过已加入的节点
  if run_remote "${IP}" "docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null" | grep -q "active"; then
    ok "  ${IP} (${ROLE}) already in Swarm"
  else
    run_remote "${IP}" "docker swarm join --token ${TOKEN} ${S1}:2377"
    ok "  ${IP} joined as ${ROLE}"
  fi
}

# S2/S3 → Manager, S4/S5 → Worker
[ -n "${S2}" ] && join_node "${S2}" "${MGR_TOKEN}" "manager"
[ -n "${S3}" ] && join_node "${S3}" "${MGR_TOKEN}" "manager"
[ -n "${S4}" ] && join_node "${S4}" "${WKR_TOKEN}" "worker"
[ -n "${S5}" ] && join_node "${S5}" "${WKR_TOKEN}" "worker"

# ── Done ──
echo ""
echo "════════════════════════════════════════════"
ok "Cluster ready! (${#ALL_NODES[@]} nodes)"
echo "════════════════════════════════════════════"
docker node ls
echo ""
echo "Next: Configure GitHub Variables and trigger deploy."
echo ""
