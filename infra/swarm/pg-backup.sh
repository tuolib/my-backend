#!/bin/bash
# pg-backup.sh — PostgreSQL 定时备份
#
# 由 init-node.sh 配置 cron 在 Patroni 主节点执行
# 每天 pg_dump 全量备份，保留 7 天，自动清理
#
# 用法（cron）: docker exec $(docker ps -qf name=ecom_patroni-1) /scripts/pg-backup.sh

set -e

BACKUP_DIR="/var/lib/postgresql/data/backups"
RETENTION_DAYS=7
DB_NAME="ecommerce"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

# 仅在 Primary 节点执行（Replica 跳过）
if ! patronictl list -f json 2>/dev/null | python3 -c "
import sys, json
members = json.load(sys.stdin)
import os
name = os.environ.get('PATRONI_NAME', '')
for m in members:
    if m.get('Member') == name and m.get('Role') == 'Leader':
        sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
    echo "Not the primary node, skipping backup"
    exit 0
fi

mkdir -p "${BACKUP_DIR}"

echo "Starting backup: ${BACKUP_FILE}"
pg_dump -U postgres -d "${DB_NAME}" | gzip > "${BACKUP_FILE}"
echo "Backup completed: $(du -h "${BACKUP_FILE}" | awk '{print $1}')"

# 清理过期备份
DELETED=$(find "${BACKUP_DIR}" -name "*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [ "${DELETED}" -gt 0 ]; then
    echo "Cleaned up ${DELETED} old backup(s)"
fi
