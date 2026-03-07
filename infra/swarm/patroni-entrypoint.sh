#!/bin/bash
# patroni-entrypoint.sh — 读取 Docker Secret，配置并启动 Patroni
#
# Docker Secret → 环境变量 → Patroni 自动覆盖 YAML 中对应配置

set -e

# 从 Docker Secret 读取密码
export PATRONI_SUPERUSER_PASSWORD=$(cat /run/secrets/postgres_password)
export PATRONI_REPLICATION_PASSWORD=$(cat /run/secrets/replication_password)

# 设置连接地址（PATRONI_NAME 由 docker-stack.yml 环境变量传入）
export PATRONI_RESTAPI_CONNECT_ADDRESS="${PATRONI_NAME}:8008"
export PATRONI_POSTGRESQL_CONNECT_ADDRESS="${PATRONI_NAME}:5432"

# 确保数据目录权限正确
if [ ! -d "/var/lib/postgresql/data/pgdata" ]; then
    mkdir -p /var/lib/postgresql/data/pgdata
fi
chown -R postgres:postgres /var/lib/postgresql/data

exec patroni /etc/patroni/patroni.yml
