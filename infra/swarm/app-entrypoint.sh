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

# ── 等待 data-proxy PG 端口可用（最多 30s） ──

RETRY=0
while [ $RETRY -lt 30 ]; do
    if bun -e "const s=require('net').connect(5432,'data-proxy');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),2000)" 2>/dev/null; then
        break
    fi
    RETRY=$((RETRY + 1))
    sleep 1
done
if [ $RETRY -ge 30 ]; then
    echo "WARNING: data-proxy:5432 not reachable after 30s, starting anyway..."
fi

exec "$@"
