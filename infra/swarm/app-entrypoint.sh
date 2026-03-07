#!/bin/sh
# app-entrypoint.sh — 读取 Docker Secret 注入环境变量，启动应用
#
# Docker Swarm 不支持在 environment 中引用 secret 文件，
# 因此通过此入口脚本将 /run/secrets/* 转为环境变量，
# 应用代码零改动。

set -e

echo "======== App Entrypoint ========"
echo "Hostname: $(hostname)"
echo "Command: $*"
echo "Date: $(date -u)"

# 读取 secrets
MISSING_SECRETS=""
for SECRET_FILE in postgres_password jwt_access_secret jwt_refresh_secret internal_secret; do
    if [ -f "/run/secrets/${SECRET_FILE}" ]; then
        echo "Secret ${SECRET_FILE}: loaded"
    else
        echo "ERROR: /run/secrets/${SECRET_FILE} not found!"
        MISSING_SECRETS="${MISSING_SECRETS} ${SECRET_FILE}"
    fi
done
if [ -n "${MISSING_SECRETS}" ]; then
    echo "Missing secrets:${MISSING_SECRETS}"
    echo "Available secrets:"
    ls -la /run/secrets/ 2>/dev/null || echo "  /run/secrets/ does not exist"
    exit 1
fi

POSTGRES_PASSWORD=$(cat /run/secrets/postgres_password)
JWT_ACCESS_SECRET=$(cat /run/secrets/jwt_access_secret)
JWT_REFRESH_SECRET=$(cat /run/secrets/jwt_refresh_secret)
INTERNAL_SECRET=$(cat /run/secrets/internal_secret)

# 构造连接字符串（指向 data-proxy HAProxy）
export DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@data-proxy:5432/ecommerce"
export REDIS_URL="redis://data-proxy:6379"
export JWT_ACCESS_SECRET
export JWT_REFRESH_SECRET
export INTERNAL_SECRET

echo "DATABASE_URL: postgresql://postgres:***@data-proxy:5432/ecommerce"
echo "REDIS_URL: redis://data-proxy:6379"

# 等待 data-proxy PG 端口可用（最多 30s）
echo "Checking data-proxy:5432 connectivity..."
RETRY=0
while [ $RETRY -lt 30 ]; do
    if bun -e "const s=require('net').connect(5432,'data-proxy');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),2000)" 2>/dev/null; then
        echo "  data-proxy:5432 (PG): reachable (${RETRY}s)"
        break
    fi
    RETRY=$((RETRY + 1))
    if [ $((RETRY % 10)) -eq 0 ]; then
        echo "  Waiting for data-proxy:5432... (${RETRY}s)"
    fi
    sleep 1
done
if [ $RETRY -ge 30 ]; then
    echo "WARNING: data-proxy:5432 not reachable after 30s, starting anyway..."
fi

echo "Starting: $*"
exec "$@"
