#!/bin/bash
# Patroni 首次引导后执行 — 创建业务数据库和 Schema
set -e

createdb -U postgres ecommerce

psql -U postgres -d ecommerce <<SQL
CREATE SCHEMA IF NOT EXISTS user_service;
CREATE SCHEMA IF NOT EXISTS product_service;
CREATE SCHEMA IF NOT EXISTS order_service;
SQL

echo "=== Database 'ecommerce' and schemas created ==="
