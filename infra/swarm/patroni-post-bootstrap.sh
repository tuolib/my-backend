#!/bin/bash
# patroni-post-bootstrap.sh — Patroni 首次引导后创建数据库和 Schema
#
# Patroni 调用时设置 PGHOST/PGPORT/PGUSER 环境变量，并传入连接 URI 作为 $1
# 仅在集群首次初始化时由 leader 执行一次

echo "======== Post-Bootstrap ========"
echo "  Args: $*"
echo "  PGHOST=${PGHOST:-unset}"
echo "  PGPORT=${PGPORT:-unset}"
echo "  PGUSER=${PGUSER:-unset}"
echo "  whoami: $(whoami)"
echo "  pwd: $(pwd)"

# 测试 psql 连接
echo "Testing psql connectivity..."
if psql -c "SELECT 1;" 2>&1; then
    echo "  psql connection: OK"
else
    echo "  psql connection via env vars FAILED, trying with URI..."
    if [ -n "$1" ] && psql "$1" -c "SELECT 1;" 2>&1; then
        echo "  psql connection via URI: OK"
        # URI 能用，后续命令也用 URI
        PSQL_CMD="psql $1"
    else
        echo "  ERROR: Cannot connect to PostgreSQL at all!"
        echo "  pg_hba.conf:"
        cat /var/lib/postgresql/data/pgdata/pg_hba.conf 2>/dev/null || echo "    (not found)"
        echo "  pg_isready:"
        pg_isready 2>&1 || true
        echo "  Exiting with 0 to avoid blocking Patroni bootstrap"
        exit 0
    fi
fi
PSQL_CMD="${PSQL_CMD:-psql}"

# 创建业务数据库
echo "Creating database 'ecommerce'..."
if ${PSQL_CMD} -c "CREATE DATABASE ecommerce;" 2>&1; then
    echo "  Database 'ecommerce' created"
else
    echo "  CREATE DATABASE returned error (may already exist), continuing..."
fi

# 创建各服务 Schema
echo "Creating schemas..."
${PSQL_CMD} -d ecommerce -c "CREATE SCHEMA IF NOT EXISTS user_service;" 2>&1 && echo "  user_service: OK" || echo "  user_service: FAILED"
${PSQL_CMD} -d ecommerce -c "CREATE SCHEMA IF NOT EXISTS product_service;" 2>&1 && echo "  product_service: OK" || echo "  product_service: FAILED"
${PSQL_CMD} -d ecommerce -c "CREATE SCHEMA IF NOT EXISTS order_service;" 2>&1 && echo "  order_service: OK" || echo "  order_service: FAILED"

echo "======== Post-Bootstrap Done ========"
exit 0
