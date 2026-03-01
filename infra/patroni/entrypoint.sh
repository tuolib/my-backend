#!/bin/sh
# Patroni 入口脚本 — 从 Docker Secrets 读取密码并启动 Patroni
# 注意：必须以 postgres 用户运行 Patroni，否则 initdb 会拒绝 root

set -e

# 读取 Docker Secrets 导出为环境变量
if [ -f /run/secrets/postgres_password ]; then
  export PATRONI_SUPERUSER_PASSWORD="$(cat /run/secrets/postgres_password)"
fi

if [ -f /run/secrets/replication_password ]; then
  export PATRONI_REPLICATION_PASSWORD="$(cat /run/secrets/replication_password)"
fi

# 确保数据目录存在且归 postgres 用户所有
# 使用子目录 pgdata 而非挂载点本身，避免 Patroni 无法重命名挂载点
mkdir -p /var/lib/postgresql/data/pgdata
chown -R postgres:postgres /var/lib/postgresql/data

# 以 postgres 用户启动 Patroni（gosu 由 postgres:16-alpine 基础镜像提供）
exec gosu postgres patroni /etc/patroni/patroni.yml
