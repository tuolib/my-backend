#!/bin/bash
# patroni-entrypoint.sh — 读取 Docker Secret，配置并启动 Patroni

set -e

# ── 1. 读取 Docker Secret ──

for SECRET in postgres_password replication_password; do
    if [ ! -f "/run/secrets/${SECRET}" ]; then
        echo "ERROR: /run/secrets/${SECRET} not found!"
        exit 1
    fi
done

export PATRONI_SUPERUSER_PASSWORD=$(cat /run/secrets/postgres_password)
export PATRONI_REPLICATION_PASSWORD=$(cat /run/secrets/replication_password)

# ── 2. 设置 Patroni 连接地址 ──

export PATRONI_RESTAPI_CONNECT_ADDRESS="${PATRONI_NAME}:8008"
export PATRONI_POSTGRESQL_CONNECT_ADDRESS="${PATRONI_NAME}:5432"

# ── 3. 注入密码到 Patroni YAML ──

cp /etc/patroni/patroni.yml /tmp/patroni.yml
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

# ── 4. 数据目录准备 ──

DATA_DIR="/var/lib/postgresql/data/pgdata"
SCOPE="ecom-pg"
mkdir -p "${DATA_DIR}"

# ── 5. 等待 etcd quorum（至少 2/3 节点） ──

MAX_RETRIES=30
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
    REACHABLE=0
    for ETCD_HOST in etcd-1:2379 etcd-2:2379 etcd-3:2379; do
        if python3 -c "import urllib.request; urllib.request.urlopen('http://${ETCD_HOST}/health', timeout=3)" 2>/dev/null; then
            REACHABLE=$((REACHABLE + 1))
        fi
    done
    [ $REACHABLE -ge 2 ] && break
    RETRY=$((RETRY + 1))
    sleep 2
done
if [ $RETRY -eq $MAX_RETRIES ]; then
    echo "WARNING: etcd quorum not confirmed, starting Patroni anyway..."
fi

# ── 6. 清理过期本地数据 ──

if [ -n "$(ls -A "${DATA_DIR}" 2>/dev/null)" ]; then
    if [ ! -f "${DATA_DIR}/PG_VERSION" ]; then
        echo "Partial initdb detected, cleaning up..."
        rm -rf "${DATA_DIR:?}"/*
    else
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

        if [ "${CLUSTER_STATE}" = "empty" ]; then
            echo "Stale pgdata detected (etcd empty), cleaning up..."
            rm -rf "${DATA_DIR:?}"/*
        fi
    fi
fi

chown -R postgres:postgres /var/lib/postgresql/data

# ── 7. 密码同步：确保 PG 内用户密码与当前 Secret 一致 ──

if [ -f "${DATA_DIR}/PG_VERSION" ] && [ ! -f "${DATA_DIR}/standby.signal" ]; then
    PW_SU=$(printf '%s' "${PATRONI_SUPERUSER_PASSWORD}" | sed "s/'/''/g")
    PW_REPL=$(printf '%s' "${PATRONI_REPLICATION_PASSWORD}" | sed "s/'/''/g")

    if gosu postgres pg_ctl -D "${DATA_DIR}" start -w -t 30 \
        -o "-c listen_addresses='' -c logging_collector=off" >/dev/null 2>&1; then

        gosu postgres psql -qc "ALTER USER postgres PASSWORD '${PW_SU}';" 2>/dev/null || true
        gosu postgres psql -qc "
            DO \$\$ BEGIN
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='replicator') THEN
                    CREATE USER replicator WITH REPLICATION PASSWORD '${PW_REPL}';
                ELSE
                    ALTER USER replicator PASSWORD '${PW_REPL}';
                END IF;
            END \$\$;" 2>/dev/null || true

        gosu postgres pg_ctl -D "${DATA_DIR}" stop -w -t 15 2>/dev/null || \
            gosu postgres pg_ctl -D "${DATA_DIR}" stop -m immediate -w -t 5 2>/dev/null || true
        echo "Password sync completed"
    else
        echo "ERROR: PG failed to start for password sync, cleaning for fresh bootstrap..."
        rm -rf "${DATA_DIR:?}"/*
    fi
fi

# ── 8. 启动 Patroni ──

exec gosu postgres patroni /tmp/patroni.yml
