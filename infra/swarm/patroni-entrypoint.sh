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

# 确保数据目录权限正确，清理失败的初始化残留
DATA_DIR="/var/lib/postgresql/data/pgdata"
if [ ! -d "${DATA_DIR}" ]; then
    echo "Creating data directory: ${DATA_DIR}"
    mkdir -p "${DATA_DIR}"
elif [ -n "$(ls -A "${DATA_DIR}" 2>/dev/null)" ] && [ ! -f "${DATA_DIR}/PG_VERSION" ]; then
    echo "Data directory has partial/corrupted data (no PG_VERSION), cleaning up..."
    rm -rf "${DATA_DIR:?}"/*
else
    echo "Data directory exists: ${DATA_DIR}"
    echo "  Contents: $(ls -A "${DATA_DIR}" 2>/dev/null | head -20)"
fi
chown -R postgres:postgres /var/lib/postgresql/data

# 等待 etcd 集群就绪（至少 2/3 节点可达 = 有 quorum）
echo "Waiting for etcd cluster quorum..."
MAX_RETRIES=30
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
    REACHABLE=0
    for ETCD_HOST in etcd-1:2379 etcd-2:2379 etcd-3:2379; do
        if python3 -c "import urllib.request; urllib.request.urlopen('http://${ETCD_HOST}/health', timeout=3)" 2>/dev/null; then
            REACHABLE=$((REACHABLE + 1))
        fi
    done
    if [ $REACHABLE -ge 2 ]; then
        echo "  etcd quorum ready (${REACHABLE}/3 nodes reachable)"
        break
    fi
    RETRY=$((RETRY + 1))
    echo "  etcd not ready (${REACHABLE}/3 reachable), retry ${RETRY}/${MAX_RETRIES}..."
    sleep 2
done
if [ $RETRY -eq $MAX_RETRIES ]; then
    echo "WARNING: etcd quorum not confirmed after ${MAX_RETRIES} retries, starting Patroni anyway..."
fi

echo "Starting Patroni..."
exec patroni /etc/patroni/patroni.yml
