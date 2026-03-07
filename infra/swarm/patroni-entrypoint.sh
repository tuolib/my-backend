#!/bin/bash
# Patroni 启动入口 — 从 Docker Swarm Secrets 加载密码
set -e

export PATRONI_SUPERUSER_PASSWORD=$(cat /run/secrets/postgres_password)
export PATRONI_REPLICATION_PASSWORD=$(cat /run/secrets/postgres_password)

exec patroni /etc/patroni/patroni.yml
