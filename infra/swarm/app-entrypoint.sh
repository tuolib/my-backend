#!/bin/sh
# 所有应用服务共享的启动入口
# 读取 Docker Swarm Secrets -> 注入环境变量 -> exec 传入的命令
set -e

export JWT_ACCESS_SECRET=$(cat /run/secrets/jwt_access_secret)
export JWT_REFRESH_SECRET=$(cat /run/secrets/jwt_refresh_secret)
export INTERNAL_SECRET=$(cat /run/secrets/internal_secret)
export DATABASE_URL="postgresql://postgres:$(cat /run/secrets/postgres_password)@pg-proxy:5432/ecommerce"

exec "$@"
