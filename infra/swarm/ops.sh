#!/bin/bash
# ops.sh — Swarm 运维工具
#
# 仅保留运维调试命令，不与 GitHub Actions 重叠
# deploy / migrate / setup / init 由 GitHub Actions 或 init-node.sh 处理
#
# 用法:
#   ops.sh status              — 服务状态 + 节点列表 + 最近失败
#   ops.sh logs <service>      — 查看服务日志（tail -f）
#   ops.sh rollback <service>  — 回滚到上一版本
#   ops.sh reload <service>    — 强制重启（如 reload nginx 加载新证书）
#   ops.sh scale <service> N   — 扩缩容

set -euo pipefail

STACK="ecom"

usage() {
    echo "Usage: ops.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  status              Show service status, node list, and recent failures"
    echo "  logs <service>      Tail service logs (e.g., ops.sh logs api-gateway)"
    echo "  rollback <service>  Rollback service to previous image"
    echo "  reload <service>    Force restart a service"
    echo "  scale <service> N   Scale service to N replicas"
    exit 1
}

cmd_status() {
    echo "═══════ Nodes ═══════"
    docker node ls
    echo ""

    echo "═══════ Services ═══════"
    docker stack services "${STACK}" --format "table {{.Name}}\t{{.Mode}}\t{{.Replicas}}\t{{.Image}}"
    echo ""

    echo "═══════ Recent Failures (last 10) ═══════"
    docker service ls --format '{{.Name}}' --filter "label=com.docker.stack.namespace=${STACK}" | while read -r SVC; do
        FAILED=$(docker service ps "${SVC}" --filter "desired-state=shutdown" --format "{{.Name}}\t{{.CurrentState}}\t{{.Error}}" 2>/dev/null | head -3)
        if [ -n "${FAILED}" ]; then
            echo "── ${SVC} ──"
            echo "${FAILED}"
        fi
    done

    echo ""
    echo "═══════ Patroni Cluster ═══════"
    PATRONI_CONTAINER=$(docker ps -qf "name=${STACK}_patroni-1" 2>/dev/null | head -1)
    if [ -n "${PATRONI_CONTAINER}" ]; then
        docker exec "${PATRONI_CONTAINER}" patronictl list 2>/dev/null || echo "Patroni not ready"
    else
        echo "Patroni container not found"
    fi

    echo ""
    echo "═══════ Data Proxy (HAProxy) ═══════"
    HAPROXY_CONTAINER=$(docker ps -qf "name=${STACK}_data-proxy" 2>/dev/null | head -1)
    if [ -n "${HAPROXY_CONTAINER}" ]; then
        docker exec "${HAPROXY_CONTAINER}" sh -c 'echo "show stat" | socat stdio /var/run/haproxy.sock 2>/dev/null' \
            | awk -F',' 'NR>1 && $2!="" {printf "%-20s %-15s %s\n", $1"/"$2, $18, $17}' 2>/dev/null \
            || echo "Stats socket not available, check :8404/stats"
    else
        echo "HAProxy container not found"
    fi
}

cmd_logs() {
    local SERVICE="${1:?Service name required. Example: ops.sh logs api-gateway}"
    docker service logs -f --tail 100 "${STACK}_${SERVICE}"
}

cmd_rollback() {
    local SERVICE="${1:?Service name required. Example: ops.sh rollback api-gateway}"
    echo "Rolling back ${STACK}_${SERVICE}..."
    docker service rollback "${STACK}_${SERVICE}"
    echo "Rollback initiated. Use 'ops.sh status' to verify."
}

cmd_reload() {
    local SERVICE="${1:?Service name required. Example: ops.sh reload nginx}"
    echo "Force restarting ${STACK}_${SERVICE}..."
    docker service update --force "${STACK}_${SERVICE}"
    echo "Restart initiated."
}

cmd_scale() {
    local SERVICE="${1:?Service name required. Example: ops.sh scale api-gateway 3}"
    local REPLICAS="${2:?Replica count required. Example: ops.sh scale api-gateway 3}"
    echo "Scaling ${STACK}_${SERVICE} to ${REPLICAS} replicas..."
    docker service scale "${STACK}_${SERVICE}=${REPLICAS}"
}

# ── Main ──

COMMAND="${1:-}"
shift || true

case "${COMMAND}" in
    status)   cmd_status ;;
    logs)     cmd_logs "$@" ;;
    rollback) cmd_rollback "$@" ;;
    reload)   cmd_reload "$@" ;;
    scale)    cmd_scale "$@" ;;
    *)        usage ;;
esac
