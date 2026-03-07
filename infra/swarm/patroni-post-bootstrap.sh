#!/bin/bash
# patroni-post-bootstrap.sh — Patroni 首次引导后创建数据库和 Schema
#
# 仅在集群首次初始化时执行一次，后续节点加入不会重复执行

set -e

echo "Post-bootstrap: creating database and schemas..."

psql -U postgres -c "CREATE DATABASE ecommerce;" 2>/dev/null || echo "Database 'ecommerce' already exists"
psql -U postgres -d ecommerce -c "CREATE SCHEMA IF NOT EXISTS user_service;"
psql -U postgres -d ecommerce -c "CREATE SCHEMA IF NOT EXISTS product_service;"
psql -U postgres -d ecommerce -c "CREATE SCHEMA IF NOT EXISTS order_service;"

echo "Post-bootstrap: done"
