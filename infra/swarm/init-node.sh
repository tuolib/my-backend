#!/bin/bash
# init-node.sh — 一键初始化 Docker Swarm 集群
#
# 在 S1 上运行，自动完成：
#   1. 所有节点安装 Docker + 配置防火墙
#   2. S1 初始化 Swarm，S2/S3 加入为 Manager，S4/S5 加入为 Worker
#   3. 按 IP 分配节点标签（role=db-primary/db-replica/gateway）
#   4. 创建初始 Docker Secret（自签名 SSL 证书）
#   5. 配置 cron（Docker 垃圾清理 + PG 备份）
#
# 用法: bash init-node.sh <S1_IP> <S2_IP> <S3_IP> <S4_IP> <S5_IP>
# 前置: 所有节点已用同一 SSH Key 创建，当前在 S1 上执行

set -euo pipefail

# ── 参数校验 ──

if [ $# -ne 5 ]; then
    echo "Usage: bash init-node.sh <S1_IP> <S2_IP> <S3_IP> <S4_IP> <S5_IP>"
    echo "Example: bash init-node.sh 10.0.0.1 10.0.0.2 10.0.0.3 10.0.0.4 10.0.0.5"
    exit 1
fi

S1="$1" S2="$2" S3="$3" S4="$4" S5="$5"
ALL_NODES=("$S1" "$S2" "$S3" "$S4" "$S5")
MANAGERS=("$S2" "$S3")
WORKERS=("$S4" "$S5")
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

echo "═══════════════════════════════════════════════════════════════"
echo "  Docker Swarm Cluster Initialization"
echo "═══════════════════════════════════════════════════════════════"
echo "  S1 (db-primary): ${S1}"
echo "  S2 (db-replica):  ${S2}"
echo "  S3 (gateway):     ${S3}"
echo "  S4 (worker):      ${S4}"
echo "  S5 (worker):      ${S5}"
echo "═══════════════════════════════════════════════════════════════"

# ── Step 1: 所有节点安装 Docker + 配置防火墙 ──

install_and_configure() {
    local IP="$1"
    local LABEL="$2"
    echo ""
    echo "── [${LABEL}] ${IP}: Installing Docker & configuring firewall ──"

    if [ "${IP}" = "${S1}" ]; then
        # 本机直接执行
        if ! command -v docker &>/dev/null; then
            curl -fsSL https://get.docker.com | sh
            systemctl enable --now docker
        else
            echo "Docker already installed"
        fi

        # 防火墙
        if command -v ufw &>/dev/null; then
            ufw allow 22/tcp
            ufw allow 80/tcp
            ufw allow 443/tcp
            ufw allow 2377/tcp    # Swarm management
            ufw allow 7946/tcp    # Node communication
            ufw allow 7946/udp
            ufw allow 4789/udp    # Overlay network (VXLAN)
            ufw --force enable
        fi
    else
        ssh ${SSH_OPTS} root@"${IP}" bash <<'REMOTE_SCRIPT'
            # Docker
            if ! command -v docker &>/dev/null; then
                curl -fsSL https://get.docker.com | sh
                systemctl enable --now docker
            else
                echo "Docker already installed"
            fi

            # Firewall
            if command -v ufw &>/dev/null; then
                ufw allow 22/tcp
                ufw allow 80/tcp
                ufw allow 443/tcp
                ufw allow 2377/tcp
                ufw allow 7946/tcp
                ufw allow 7946/udp
                ufw allow 4789/udp
                ufw --force enable
            fi
REMOTE_SCRIPT
    fi
    echo "  [${LABEL}] Done"
}

for i in "${!ALL_NODES[@]}"; do
    install_and_configure "${ALL_NODES[$i]}" "S$((i+1))"
done

# ── Step 2: 初始化 Swarm（S1 为首个 Manager） ──

echo ""
echo "── Initializing Swarm on S1 (${S1}) ──"

if docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo "Swarm already active, skipping init"
else
    docker swarm init --advertise-addr "${S1}"
fi

MANAGER_TOKEN=$(docker swarm join-token -q manager)
WORKER_TOKEN=$(docker swarm join-token -q worker)

# ── Step 3: S2/S3 加入为 Manager ──

echo ""
echo "── Joining Managers ──"

for IP in "${MANAGERS[@]}"; do
    echo "  Joining ${IP} as manager..."
    ssh ${SSH_OPTS} root@"${IP}" \
        "docker swarm join --token ${MANAGER_TOKEN} ${S1}:2377 2>/dev/null || echo 'Already in swarm'"
done

# ── Step 4: S4/S5 加入为 Worker ──

echo ""
echo "── Joining Workers ──"

for IP in "${WORKERS[@]}"; do
    echo "  Joining ${IP} as worker..."
    ssh ${SSH_OPTS} root@"${IP}" \
        "docker swarm join --token ${WORKER_TOKEN} ${S1}:2377 2>/dev/null || echo 'Already in swarm'"
done

# ── Step 5: 按 IP 分配节点标签 ──

echo ""
echo "── Labeling nodes ──"

# 等待所有节点就绪
sleep 3

for NODE_ID in $(docker node ls -q); do
    NODE_ADDR=$(docker node inspect "${NODE_ID}" --format '{{.Status.Addr}}')
    if [ "${NODE_ADDR}" = "${S1}" ]; then
        docker node update --label-add role=db-primary "${NODE_ID}"
        echo "  ${NODE_ADDR} → role=db-primary"
    elif [ "${NODE_ADDR}" = "${S2}" ]; then
        docker node update --label-add role=db-replica "${NODE_ID}"
        echo "  ${NODE_ADDR} → role=db-replica"
    elif [ "${NODE_ADDR}" = "${S3}" ]; then
        docker node update --label-add role=gateway "${NODE_ID}"
        echo "  ${NODE_ADDR} → role=gateway"
    else
        echo "  ${NODE_ADDR} → (worker, no label)"
    fi
done

# ── Step 6: 创建自签名 SSL 证书（让 Nginx 首次启动能监听 443） ──

echo ""
echo "── Creating self-signed SSL certificate ──"

if docker secret inspect ssl_cert >/dev/null 2>&1; then
    echo "SSL secrets already exist, skipping"
else
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /tmp/selfsigned.key -out /tmp/selfsigned.crt \
        -subj "/CN=localhost" 2>/dev/null
    docker secret create ssl_cert /tmp/selfsigned.crt
    docker secret create ssl_key /tmp/selfsigned.key
    rm -f /tmp/selfsigned.crt /tmp/selfsigned.key
    echo "Self-signed SSL secrets created"
fi

# ── Step 7: Docker 垃圾清理 cron（所有节点） ──

echo ""
echo "── Setting up Docker cleanup cron ──"

CLEANUP_CRON='0 3 * * * docker system prune -af --filter "until=72h" >/dev/null 2>&1'

# 本机
(crontab -l 2>/dev/null | grep -v "docker system prune"; echo "${CLEANUP_CRON}") | crontab -

# 远程节点
for IP in "${ALL_NODES[@]:1}"; do
    ssh ${SSH_OPTS} root@"${IP}" bash -c "'
        (crontab -l 2>/dev/null | grep -v \"docker system prune\"; echo \"${CLEANUP_CRON}\") | crontab -
    '"
done
echo "Docker cleanup cron configured on all nodes"

# ── Step 8: PG 备份 cron（S1） ──

echo ""
echo "── Setting up PG backup cron ──"

BACKUP_CRON='0 2 * * * docker exec $(docker ps -qf name=ecom_patroni-1 --format "{{.ID}}" | head -1) /scripts/pg-backup.sh >/dev/null 2>&1'
(crontab -l 2>/dev/null | grep -v "pg-backup"; echo "${BACKUP_CRON}") | crontab -
echo "PG backup cron configured on S1"

# ── 完成 ──

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Cluster initialization complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
docker node ls
echo ""
echo "Next steps:"
echo "  1. Configure GitHub Secrets (SSH key, GHCR PAT, DB passwords, JWT secrets)"
echo "  2. Configure GitHub Variables (SWARM_HOST=${S1}, SWARM_USER=root, DOMAIN, EMAIL)"
echo "  3. Push code or trigger GitHub Actions to deploy"
echo "  4. Point DNS A records to all 5 IPs for ingress mesh"
