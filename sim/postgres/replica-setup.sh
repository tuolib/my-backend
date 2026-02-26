#!/bin/sh
# 从库初始化脚本：首次启动时从主库克隆数据，之后直接启动 postgres
set -eu

PRIMARY_HOST="${PRIMARY_HOST:-postgres-primary}"
REPLICATION_USER="${REPLICATION_USER:-replicator}"
REPLICATION_PASSWORD="${REPLICATION_PASSWORD:-repl_password}"

if [ -z "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
  echo ">>> PGDATA 为空，等待主库就绪..."
  until PGPASSWORD="$POSTGRES_PASSWORD" pg_isready -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q; do
    echo ">>> 主库未就绪，3 秒后重试..."
    sleep 3
  done

  echo ">>> 开始 pg_basebackup 从主库克隆数据..."
  PGPASSWORD="$REPLICATION_PASSWORD" pg_basebackup \
    -h "$PRIMARY_HOST" \
    -U "$REPLICATION_USER" \
    -D "$PGDATA" \
    --wal-method=stream \
    --checkpoint=fast \
    --progress \
    --no-password

  # PostgreSQL 12+ 使用 standby.signal 标记从库模式
  touch "$PGDATA/standby.signal"

  # 写入流复制连接配置
  cat >> "$PGDATA/postgresql.auto.conf" <<EOF
primary_conninfo = 'host=${PRIMARY_HOST} port=5432 user=${REPLICATION_USER} password=${REPLICATION_PASSWORD}'
EOF

  chmod 700 "$PGDATA"
  echo ">>> pg_basebackup 完成，从库初始化成功。"
fi

echo ">>> 启动从库 PostgreSQL..."
exec /usr/local/bin/docker-entrypoint.sh postgres "$@"
