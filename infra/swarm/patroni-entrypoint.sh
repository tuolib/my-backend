#!/bin/bash
# patroni-entrypoint.sh — 读取 Docker Secret，配置并启动 Patroni
#
# Docker Secret → 环境变量 → Patroni 自动覆盖 YAML 中对应配置

set -e

echo "======== Patroni Entrypoint ========"
echo "PATRONI_NAME: ${PATRONI_NAME:-NOT SET}"
echo "Hostname: $(hostname)"
echo "Date: $(date -u)"

# 从 Docker Secret 读取密码
if [ -f /run/secrets/postgres_password ]; then
    export PATRONI_SUPERUSER_PASSWORD=$(cat /run/secrets/postgres_password)
    echo "Secret postgres_password: loaded (${#PATRONI_SUPERUSER_PASSWORD} chars)"
else
    echo "ERROR: /run/secrets/postgres_password not found!"
    ls -la /run/secrets/ 2>/dev/null || echo "  /run/secrets/ does not exist"
    exit 1
fi

if [ -f /run/secrets/replication_password ]; then
    export PATRONI_REPLICATION_PASSWORD=$(cat /run/secrets/replication_password)
    echo "Secret replication_password: loaded (${#PATRONI_REPLICATION_PASSWORD} chars)"
else
    echo "ERROR: /run/secrets/replication_password not found!"
    exit 1
fi

# 设置连接地址（PATRONI_NAME 由 docker-stack.yml 环境变量传入）
export PATRONI_RESTAPI_CONNECT_ADDRESS="${PATRONI_NAME}:8008"
export PATRONI_POSTGRESQL_CONNECT_ADDRESS="${PATRONI_NAME}:5432"
echo "REST API: ${PATRONI_RESTAPI_CONNECT_ADDRESS}"
echo "PG Connect: ${PATRONI_POSTGRESQL_CONNECT_ADDRESS}"

# 确保数据目录权限正确
DATA_DIR="/var/lib/postgresql/data/pgdata"
if [ ! -d "${DATA_DIR}" ]; then
    echo "Creating data directory: ${DATA_DIR}"
    mkdir -p "${DATA_DIR}"
else
    echo "Data directory exists: ${DATA_DIR}"
    echo "  Contents: $(ls -A "${DATA_DIR}" 2>/dev/null | head -20)"
fi
chown -R postgres:postgres /var/lib/postgresql/data

# 检查 etcd 可达性
echo "Checking etcd connectivity..."
for ETCD_HOST in etcd-1:2379 etcd-2:2379 etcd-3:2379; do
    if python3 -c "import urllib.request; urllib.request.urlopen('http://${ETCD_HOST}/health', timeout=3)" 2>/dev/null; then
        echo "  ${ETCD_HOST}: reachable"
    else
        echo "  ${ETCD_HOST}: not reachable (may be starting)"
    fi
done

echo "Starting Patroni..."
exec patroni /etc/patroni/patroni.yml
