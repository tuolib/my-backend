#!/bin/sh
# app-entrypoint.sh — 读取 Docker Secret 注入环境变量，启动应用

set -e

# ── 读取 secrets ──

MISSING=""
for SECRET in postgres_password jwt_access_secret jwt_refresh_secret internal_secret; do
    [ -f "/run/secrets/${SECRET}" ] || MISSING="${MISSING} ${SECRET}"
done
if [ -n "${MISSING}" ]; then
    echo "ERROR: missing secrets:${MISSING}"
    exit 1
fi

POSTGRES_PASSWORD=$(cat /run/secrets/postgres_password)
JWT_ACCESS_SECRET=$(cat /run/secrets/jwt_access_secret)
JWT_REFRESH_SECRET=$(cat /run/secrets/jwt_refresh_secret)
INTERNAL_SECRET=$(cat /run/secrets/internal_secret)

export DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@data-proxy:5432/ecommerce"
export REDIS_URL="redis://data-proxy:6379"
export JWT_ACCESS_SECRET JWT_REFRESH_SECRET INTERNAL_SECRET

# ── 等待 data-proxy 端口可用（PG:5432 + Redis:6379，最多各 30s） ──

wait_for_port() {
    local PORT=$1
    local RETRY=0
    while [ $RETRY -lt 30 ]; do
        if bun -e "const s=require('net').connect(${PORT},'data-proxy');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),2000)" 2>/dev/null; then
            return 0
        fi
        RETRY=$((RETRY + 1))
        sleep 1
    done
    echo "WARNING: data-proxy:${PORT} not reachable after 30s, starting anyway..."
    return 1
}

wait_for_port 5432
wait_for_port 6379

exec "$@"
