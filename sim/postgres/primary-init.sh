#!/bin/sh
set -e

# 创建流复制用户
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replicator') THEN
      CREATE USER replicator REPLICATION LOGIN ENCRYPTED PASSWORD '${REPLICATION_PASSWORD:-repl_password}';
    END IF;
  END
  \$\$;
EOSQL

# 允许从库连接复制
echo "host replication replicator 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"
