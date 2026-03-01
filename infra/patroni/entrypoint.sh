#!/bin/sh
# Patroni 入口脚本 — 从 Docker Secrets 读取密码并启动 Patroni

set -e

# 读取 Docker Secrets 导出为环境变量
if [ -f /run/secrets/postgres_password ]; then
  export PATRONI_SUPERUSER_PASSWORD="$(cat /run/secrets/postgres_password)"
fi

if [ -f /run/secrets/replication_password ]; then
  export PATRONI_REPLICATION_PASSWORD="$(cat /run/secrets/replication_password)"
fi

exec patroni /etc/patroni/patroni.yml
