#!/bin/sh
# app-entrypoint.sh — 读取 Docker Secret 注入环境变量，启动应用
#
# Docker Swarm 不支持在 environment 中引用 secret 文件，
# 因此通过此入口脚本将 /run/secrets/* 转为环境变量，
# 应用代码零改动。

set -e

# 读取 secrets
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

exec "$@"
