#!/bin/bash
# patroni-entrypoint.sh — 读取 Docker Secret，配置并启动 Patroni
#
# Docker Secret → 环境变量 → Patroni 自动覆盖 YAML 中对应配置

set -e

echo "======== Patroni Entrypoint ========"
echo "PATRONI_NAME: ${PATRONI_NAME:-NOT SET}"
echo "Hostname: $(hostname)"
echo "Date: $(date -u)"

# 从 Docker Secret 读取密码
if [ -f /run/secrets/postgres_password ]; then
    export PATRONI_SUPERUSER_PASSWORD=$(cat /run/secrets/postgres_password)
    echo "Secret postgres_password: loaded (${#PATRONI_SUPERUSER_PASSWORD} chars)"
else
    echo "ERROR: /run/secrets/postgres_password not found!"
    ls -la /run/secrets/ 2>/dev/null || echo "  /run/secrets/ does not exist"
    exit 1
fi

if [ -f /run/secrets/replication_password ]; then
    export PATRONI_REPLICATION_PASSWORD=$(cat /run/secrets/replication_password)
    echo "Secret replication_password: loaded (${#PATRONI_REPLICATION_PASSWORD} chars)"
else
    echo "ERROR: /run/secrets/replication_password not found!"
    exit 1
fi

# 设置连接地址（PATRONI_NAME 由 docker-stack.yml 环境变量传入）
export PATRONI_RESTAPI_CONNECT_ADDRESS="${PATRONI_NAME}:8008"
export PATRONI_POSTGRESQL_CONNECT_ADDRESS="${PATRONI_NAME}:5432"
echo "REST API: ${PATRONI_RESTAPI_CONNECT_ADDRESS}"
echo "PG Connect: ${PATRONI_POSTGRESQL_CONNECT_ADDRESS}"

# 将密码注入 Patroni YAML（避免依赖 env var override 机制）
PATRONI_YML="/etc/patroni/patroni.yml"
cp "${PATRONI_YML}" /tmp/patroni.yml
python3 -c "
import yaml, os
with open('/tmp/patroni.yml') as f:
    cfg = yaml.safe_load(f)
auth = cfg['postgresql']['authentication']
auth['superuser']['password'] = os.environ['PATRONI_SUPERUSER_PASSWORD']
auth['replication']['password'] = os.environ['PATRONI_REPLICATION_PASSWORD']
with open('/tmp/patroni.yml', 'w') as f:
    yaml.dump(cfg, f, default_flow_style=False)
"
PATRONI_YML="/tmp/patroni.yml"
echo "Passwords injected into Patroni config"

# 数据目录
DATA_DIR="/var/lib/postgresql/data/pgdata"
SCOPE="ecom-pg"
mkdir -p "${DATA_DIR}"

# 等待 etcd 集群就绪（至少 2/3 节点可达 = 有 quorum）
echo "Waiting for etcd cluster quorum..."
MAX_RETRIES=30
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
    REACHABLE=0
    for ETCD_HOST in etcd-1:2379 etcd-2:2379 etcd-3:2379; do
        if python3 -c "import urllib.request; urllib.request.urlopen('http://${ETCD_HOST}/health', timeout=3)" 2>/dev/null; then
            REACHABLE=$((REACHABLE + 1))
        fi
    done
    if [ $REACHABLE -ge 2 ]; then
        echo "  etcd quorum ready (${REACHABLE}/3 nodes reachable)"
        break
    fi
    RETRY=$((RETRY + 1))
    echo "  etcd not ready (${REACHABLE}/3 reachable), retry ${RETRY}/${MAX_RETRIES}..."
    sleep 2
done
if [ $RETRY -eq $MAX_RETRIES ]; then
    echo "WARNING: etcd quorum not confirmed after ${MAX_RETRIES} retries, starting Patroni anyway..."
fi

# 自动清理过期本地数据
# 判断逻辑：etcd 中无已初始化集群 → 本地残留数据必定过期
HAS_LOCAL_DATA="false"
if [ -n "$(ls -A "${DATA_DIR}" 2>/dev/null)" ]; then
    HAS_LOCAL_DATA="true"
fi

if [ "${HAS_LOCAL_DATA}" = "true" ]; then
    # 情况 1：initdb 未完成（无 PG_VERSION）→ 直接清理
    if [ ! -f "${DATA_DIR}/PG_VERSION" ]; then
        echo "Partial initdb detected (no PG_VERSION), cleaning up..."
        rm -rf "${DATA_DIR:?}"/*
    else
        # 情况 2：查询 etcd 确认集群是否已初始化
        CLUSTER_STATE=$(python3 -c "
import urllib.request, urllib.error
for host in ['etcd-1:2379', 'etcd-2:2379', 'etcd-3:2379']:
    try:
        urllib.request.urlopen('http://{}/v2/keys/service/${SCOPE}/initialize'.format(host), timeout=3)
        print('initialized'); break
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print('empty'); break
    except: pass
else:
    print('unknown')
" 2>/dev/null)
        echo "  etcd cluster state: ${CLUSTER_STATE}"

        if [ "${CLUSTER_STATE}" = "empty" ]; then
            echo "Cluster not initialized in etcd but local pgdata exists — stale data, cleaning up..."
            rm -rf "${DATA_DIR:?}"/*
        fi
        # 'initialized' → Patroni 正常接管（rewind/basebackup）
        # 'unknown'     → etcd 不可达，保留数据让 Patroni 自行判断
    fi
fi

chown -R postgres:postgres /var/lib/postgresql/data
echo "Data directory: ${DATA_DIR}"
echo "  Contents: $(ls -A "${DATA_DIR}" 2>/dev/null | head -5 || echo "(empty)")"

# 密码同步：已有 PG 数据时，临时启动 PG 更新用户密码
# 解决问题：旧 bootstrap 用了错误/旧密码 → replica pg_basebackup 认证失败
if [ -f "${DATA_DIR}/PG_VERSION" ] && [ ! -f "${DATA_DIR}/standby.signal" ]; then
    echo "Syncing PostgreSQL user passwords with current Docker Secrets..."
    # 仅监听 Unix socket（不开 TCP），避免外部连接干扰
    if gosu postgres pg_ctl -D "${DATA_DIR}" start -w -t 30 \
        -o "-c listen_addresses='' -c logging_collector=off"; then

        # 转义 SQL 单引号
        PW_SU=$(printf '%s' "${PATRONI_SUPERUSER_PASSWORD}" | sed "s/'/''/g")
        PW_REPL=$(printf '%s' "${PATRONI_REPLICATION_PASSWORD}" | sed "s/'/''/g")

        echo "  Updating superuser password..."
        gosu postgres psql -c "ALTER USER postgres PASSWORD '${PW_SU}';" 2>&1 || true

        # 确保 replicator 用户存在（初次 bootstrap 可能未完成就被杀）
        echo "  Updating replicator password..."
        gosu postgres psql -c "
            DO \$\$ BEGIN
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='replicator') THEN
                    CREATE USER replicator WITH REPLICATION PASSWORD '${PW_REPL}';
                ELSE
                    ALTER USER replicator PASSWORD '${PW_REPL}';
                END IF;
            END \$\$;" 2>&1 || true

        echo "  Stopping temporary PG..."
        gosu postgres pg_ctl -D "${DATA_DIR}" stop -w -t 15 || \
            gosu postgres pg_ctl -D "${DATA_DIR}" stop -m immediate -w -t 5 || true
        echo "Password sync completed"
    else
        # PG 无法启动（数据损坏 / 不完整） → 清理后让 Patroni 重新 bootstrap
        echo "ERROR: Could not start PG for password sync"
        echo "Cleaning data directory for fresh bootstrap..."
        rm -rf "${DATA_DIR:?}"/*
    fi
fi

echo "Starting Patroni as postgres user..."
exec gosu postgres patroni /tmp/patroni.yml
