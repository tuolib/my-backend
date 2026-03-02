#!/usr/bin/env bash
# init-cluster.sh — 在 S1 上执行的一键 k3s 集群初始化脚本
#
# 替代 GitHub Actions 的 k3s-cluster-setup workflow
# S1 作为控制节点，本地安装 + 内网 SSH 到其他节点
#
# 用法:
#   单节点（默认）:
#     ./init-cluster.sh --s1 <S1_IP>
#
#   多节点 HA:
#     ./init-cluster.sh --mode multi \
#       --s1 10.0.0.1 --s2 10.0.0.2 --s3 10.0.0.3 \
#       --s4 10.0.0.4 --s5 10.0.0.5 \
#       [--extra-sans "api.example.com"] \
#       [--k3s-version "v1.29.2+k3s1"] \
#       [--ssh-user root] \
#       [--ssh-key ~/.ssh/id_rsa]
#
# 执行顺序:
#   01 本地安装 k3s server (S1)
#   02 SSH 到 S2/S3 加入 server（multi）
#   03 SSH 到 S4/S5 加入 agent（multi）
#   04 本地安装 Operators (S1)
set -euo pipefail

# ─── 颜色输出 ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

banner() {
  echo ""
  echo -e "${BLUE}════════════════════════════════════════════${NC}"
  echo -e "${BLUE} $*${NC}"
  echo -e "${BLUE}════════════════════════════════════════════${NC}"
}

# ─── 默认值 ───────────────────────────────────────────────────────────────────
MODE="single"
S1_IP=""
S2_IP=""
S3_IP=""
S4_IP=""
S5_IP=""
EXTRA_SANS=""
K3S_VERSION=""
SSH_USER="root"
SSH_KEY=""
STEP="all"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── 参数解析 ──────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
用法: $0 [选项]

选项:
  --mode <single|multi>     集群模式（默认 single）
  --step <步骤>             执行指定步骤（默认 all）
                            可选: all, 01, 02, 03, 04
  --s1 <IP>                 S1 节点 IP（必须）
  --s2 <IP>                 S2 节点 IP（multi 模式）
  --s3 <IP>                 S3 节点 IP（multi 模式）
  --s4 <IP>                 S4 节点 IP（multi 模式）
  --s5 <IP>                 S5 节点 IP（multi 模式）
  --extra-sans <域名>       额外 TLS SAN（逗号分隔）
  --k3s-version <版本>      指定 k3s 版本
  --ssh-user <用户>         SSH 用户名（默认 root）
  --ssh-key <路径>          SSH 私钥路径（可选）
  -h, --help                显示帮助
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)       MODE="$2";        shift 2 ;;
    --step)       STEP="$2";        shift 2 ;;
    --s1)         S1_IP="$2";       shift 2 ;;
    --s2)         S2_IP="$2";       shift 2 ;;
    --s3)         S3_IP="$2";       shift 2 ;;
    --s4)         S4_IP="$2";       shift 2 ;;
    --s5)         S5_IP="$2";       shift 2 ;;
    --extra-sans) EXTRA_SANS="$2";  shift 2 ;;
    --k3s-version) K3S_VERSION="$2"; shift 2 ;;
    --ssh-user)   SSH_USER="$2";    shift 2 ;;
    --ssh-key)    SSH_KEY="$2";     shift 2 ;;
    -h|--help)    usage ;;
    *)            log_error "未知参数: $1"; usage ;;
  esac
done

# ─── 参数校验 ──────────────────────────────────────────────────────────────────
if [[ -z "${S1_IP}" ]]; then
  log_error "必须指定 --s1 <IP>"
  exit 1
fi

if [[ "${MODE}" == "multi" ]]; then
  MISSING=""
  [[ -z "${S2_IP}" ]] && MISSING="${MISSING} --s2"
  [[ -z "${S3_IP}" ]] && MISSING="${MISSING} --s3"
  [[ -z "${S4_IP}" ]] && MISSING="${MISSING} --s4"
  [[ -z "${S5_IP}" ]] && MISSING="${MISSING} --s5"
  if [[ -n "${MISSING}" ]]; then
    log_error "多节点模式必须指定:${MISSING}"
    exit 1
  fi
fi

# SSH 参数
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=10"
if [[ -n "${SSH_KEY}" ]]; then
  SSH_OPTS="${SSH_OPTS} -i ${SSH_KEY}"
fi

# ─── 工具函数 ──────────────────────────────────────────────────────────────────

# 远程执行命令（带重试）
remote_exec() {
  local host="$1"
  local description="$2"
  shift 2
  local cmd="$*"
  local max_attempts=3

  for attempt in $(seq 1 ${max_attempts}); do
    log_info "[${attempt}/${max_attempts}] ${description} (${host})"
    if ssh ${SSH_OPTS} "${SSH_USER}@${host}" bash -c "'${cmd}'" 2>&1; then
      log_ok "${description} 完成"
      return 0
    fi
    local exit_code=$?
    if [[ ${attempt} -lt ${max_attempts} ]]; then
      log_warn "失败 (exit ${exit_code})，15 秒后重试..."
      sleep 15
    fi
  done

  log_error "${description} 在 ${max_attempts} 次尝试后失败"
  return 1
}

# SCP 文件到远程节点（带重试）
remote_scp() {
  local host="$1"
  local src="$2"
  local dst="$3"
  local max_attempts=3

  for attempt in $(seq 1 ${max_attempts}); do
    log_info "[${attempt}/${max_attempts}] SCP ${src} → ${host}:${dst}"
    if ssh ${SSH_OPTS} "${SSH_USER}@${host}" "mkdir -p $(dirname "${dst}")" && \
       scp ${SSH_OPTS} "${src}" "${SSH_USER}@${host}:${dst}"; then
      log_ok "SCP 完成"
      return 0
    fi
    if [[ ${attempt} -lt ${max_attempts} ]]; then
      log_warn "SCP 失败，15 秒后重试..."
      sleep 15
    fi
  done

  log_error "SCP 到 ${host} 在 ${max_attempts} 次尝试后失败"
  return 1
}

# 等待远程节点 k3s 服务就绪
wait_remote_service() {
  local host="$1"
  local service="$2"
  local max_wait=60

  log_info "等待 ${host} 上 ${service} 就绪..."
  for i in $(seq 1 ${max_wait}); do
    if ssh ${SSH_OPTS} "${SSH_USER}@${host}" "systemctl is-active --quiet ${service}" 2>/dev/null; then
      log_ok "${host} 上 ${service} 已运行"
      return 0
    fi
    echo -n "."
    sleep 5
  done
  echo ""
  log_error "${host} 上 ${service} 在 $((max_wait * 5)) 秒后仍未就绪"
  return 1
}

# ─── Step 01: 安装 S1 server ──────────────────────────────────────────────────
step_01() {
  banner "Step 01: 安装 k3s Server (S1 - 本地)"

  export K3S_MODE="${MODE}"
  export NODE_IP="${S1_IP}"
  export K3S_EXTRA_SANS="${EXTRA_SANS}"
  export K3S_VERSION="${K3S_VERSION}"

  chmod +x "${SCRIPT_DIR}/01-install-server.sh"
  "${SCRIPT_DIR}/01-install-server.sh"

  log_ok "Step 01 完成"
}

# ─── Step 02: 追加 server 节点 ────────────────────────────────────────────────
step_02() {
  banner "Step 02: 追加 Server 节点 (S2, S3)"

  if [[ "${MODE}" != "multi" ]]; then
    log_info "单节点模式，跳过 Step 02"
    return 0
  fi

  # 获取 node token
  local NODE_TOKEN
  NODE_TOKEN="$(cat /var/lib/rancher/k3s/server/node-token)"
  if [[ -z "${NODE_TOKEN}" ]]; then
    log_error "无法读取 node-token"
    return 1
  fi

  local SERVER_HOSTS=("${S2_IP}" "${S3_IP}")
  local SERVER_NAMES=("S2" "S3")

  for idx in "${!SERVER_HOSTS[@]}"; do
    local host="${SERVER_HOSTS[$idx]}"
    local name="${SERVER_NAMES[$idx]}"

    if [[ -z "${host}" ]]; then
      log_warn "${name} 未配置，跳过"
      continue
    fi

    banner "Step 02: 加入 Server — ${name} (${host})"

    # SCP 脚本
    remote_scp "${host}" \
      "${SCRIPT_DIR}/02-join-server.sh" \
      "/opt/ecom/infra/k3s/cluster-setup/02-join-server.sh"

    # 远程执行
    log_info "在 ${name} 上执行 02-join-server.sh ..."
    ssh ${SSH_OPTS} "${SSH_USER}@${host}" bash -s <<REMOTE_SCRIPT
set -euo pipefail
export K3S_URL="https://${S1_IP}:6443"
export K3S_TOKEN="${NODE_TOKEN}"
export NODE_IP="${host}"
export K3S_VERSION="${K3S_VERSION}"
chmod +x /opt/ecom/infra/k3s/cluster-setup/02-join-server.sh
/opt/ecom/infra/k3s/cluster-setup/02-join-server.sh
REMOTE_SCRIPT

    # 验证
    wait_remote_service "${host}" "k3s"
    log_ok "${name} 加入完成"
  done

  log_ok "Step 02 完成"
}

# ─── Step 03: 追加 agent 节点 ─────────────────────────────────────────────────
step_03() {
  banner "Step 03: 追加 Agent 节点 (S4, S5)"

  if [[ "${MODE}" != "multi" ]]; then
    log_info "单节点模式，跳过 Step 03"
    return 0
  fi

  local NODE_TOKEN
  NODE_TOKEN="$(cat /var/lib/rancher/k3s/server/node-token)"

  local AGENT_HOSTS=("${S4_IP}" "${S5_IP}")
  local AGENT_NAMES=("S4" "S5")

  for idx in "${!AGENT_HOSTS[@]}"; do
    local host="${AGENT_HOSTS[$idx]}"
    local name="${AGENT_NAMES[$idx]}"

    if [[ -z "${host}" ]]; then
      log_warn "${name} 未配置，跳过"
      continue
    fi

    banner "Step 03: 加入 Agent — ${name} (${host})"

    # SCP 脚本
    remote_scp "${host}" \
      "${SCRIPT_DIR}/03-join-agent.sh" \
      "/opt/ecom/infra/k3s/cluster-setup/03-join-agent.sh"

    # 远程执行
    log_info "在 ${name} 上执行 03-join-agent.sh ..."
    ssh ${SSH_OPTS} "${SSH_USER}@${host}" bash -s <<REMOTE_SCRIPT
set -euo pipefail
export K3S_URL="https://${S1_IP}:6443"
export K3S_TOKEN="${NODE_TOKEN}"
export NODE_IP="${host}"
export K3S_VERSION="${K3S_VERSION}"
chmod +x /opt/ecom/infra/k3s/cluster-setup/03-join-agent.sh
/opt/ecom/infra/k3s/cluster-setup/03-join-agent.sh
REMOTE_SCRIPT

    # 验证
    wait_remote_service "${host}" "k3s-agent"
    log_ok "${name} 加入完成"
  done

  log_ok "Step 03 完成"
}

# ─── Step 04: 安装 Operators ──────────────────────────────────────────────────
step_04() {
  banner "Step 04: 安装 Operators (S1 - 本地)"

  export K3S_MODE="${MODE}"
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

  # 多节点模式：解析节点名
  if [[ "${MODE}" == "multi" ]]; then
    export S1_NODE="$(hostname)"
    export S2_NODE="$(kubectl get nodes -o wide --no-headers | grep "${S2_IP}" | awk '{print $1}' || echo "${S2_IP}")"
    export S3_NODE="$(kubectl get nodes -o wide --no-headers | grep "${S3_IP}" | awk '{print $1}' || echo "${S3_IP}")"
    export S4_NODE="$(kubectl get nodes -o wide --no-headers | grep "${S4_IP}" | awk '{print $1}' || echo "${S4_IP}")"
    export S5_NODE="$(kubectl get nodes -o wide --no-headers | grep "${S5_IP}" | awk '{print $1}' || echo "${S5_IP}")"
    log_info "节点映射: S1=${S1_NODE} S2=${S2_NODE} S3=${S3_NODE} S4=${S4_NODE} S5=${S5_NODE}"
  fi

  chmod +x "${SCRIPT_DIR}/04-install-operators.sh"
  "${SCRIPT_DIR}/04-install-operators.sh"

  log_ok "Step 04 完成"
}

# ─── 最终验证 ──────────────────────────────────────────────────────────────────
verify_cluster() {
  banner "集群验证"

  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

  echo ""
  echo "══════════ Nodes ══════════"
  kubectl get nodes -o wide

  echo ""
  echo "══════════ System Pods ══════════"
  kubectl get pods -A

  echo ""
  echo "══════════ StorageClass ══════════"
  kubectl get storageclass

  echo ""
  echo "══════════ Cluster Ready ══════════"
  local READY TOTAL
  READY=$(kubectl get nodes --no-headers | grep -c " Ready")
  TOTAL=$(kubectl get nodes --no-headers | wc -l)
  echo "${READY}/${TOTAL} nodes ready"

  if [[ "${READY}" -eq "${TOTAL}" ]]; then
    log_ok "k3s 集群初始化成功！可以开始部署应用了。"
  else
    log_warn "部分节点未就绪，请检查。"
  fi
}

# ─── 主流程 ────────────────────────────────────────────────────────────────────
main() {
  banner "k3s 集群初始化 (mode=${MODE})"
  log_info "S1=${S1_IP}"
  if [[ "${MODE}" == "multi" ]]; then
    log_info "S2=${S2_IP} S3=${S3_IP} S4=${S4_IP} S5=${S5_IP}"
  fi
  log_info "Step=${STEP}"
  echo ""

  case "${STEP}" in
    all)
      step_01
      step_02
      step_03
      step_04
      verify_cluster
      ;;
    01) step_01 ;;
    02) step_02 ;;
    03) step_03 ;;
    04) step_04 ;;
    verify) verify_cluster ;;
    *)
      log_error "未知步骤: ${STEP}（可选: all, 01, 02, 03, 04, verify）"
      exit 1
      ;;
  esac

  banner "完成！"
}

main
