#!/bin/sh
# Patroni bootstrap post_init — 创建数据库和各微服务的 PG Schema
# 此脚本仅在集群初次 bootstrap 时由 Leader 执行一次

set -e

echo "=== Patroni post_init: 创建数据库 ==="

psql -U postgres <<SQL
CREATE DATABASE ecommerce;
SQL

echo "=== Patroni post_init: 创建微服务 Schema ==="

psql -U postgres -d ecommerce <<SQL
CREATE SCHEMA IF NOT EXISTS user_service;
CREATE SCHEMA IF NOT EXISTS product_service;
CREATE SCHEMA IF NOT EXISTS order_service;
SQL

echo "=== 数据库和 Schema 创建完成 ==="
