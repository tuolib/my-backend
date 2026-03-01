#!/bin/bash
# PG Primary 初始化脚本 — 启用流复制
# 在 /docker-entrypoint-initdb.d/ 中执行，initdb 完成后运行

set -e

echo "=== 配置 PostgreSQL 流复制 ==="

# 添加 replication 连接权限到 pg_hba.conf
# 允许任意 IP 通过密码认证进行流复制（Swarm overlay 网络）
echo "host replication all 0.0.0.0/0 scram-sha-256" >> "$PGDATA/pg_hba.conf"

echo "=== 流复制配置完成 ==="
