#!/bin/bash
set -e

# 创建流复制用户
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE USER replicator REPLICATION LOGIN ENCRYPTED PASSWORD '${REPLICATION_PASSWORD:-repl_password}';
EOSQL

# 允许从库连接复制
echo "host replication replicator 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"
