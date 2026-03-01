# PostgreSQL 高可用升级：从手动主从到 Patroni 自动故障转移

## 一、为什么要做这次升级

### 旧架构的问题

```
App → postgres-primary:5432（硬编码，固定在 S1 节点）
      postgres-replica:5432（S2，流复制只读副本）
```

- **S1 宕机 = 数据库不可用**：所有写操作立即失败，整个平台停写
- **恢复依赖人工**：运维需要手动 SSH 到 S2、提升为主库、修改应用配置、重启服务
- **恢复时间不可控**：从发现故障到恢复，通常 10-30 分钟甚至更久
- **主从角色硬编码**：节点标签 `db-primary` / `db-replica` 写死了谁是主、谁是从，无法动态切换

### 升级目标

S1 宕机后 **10-30 秒内自动将 S2 提升为主库**，应用无需修改配置即可重连。

---

## 二、新架构全景

```
                    ┌──────────────┐
                    │   App 服务    │
                    │ (5个微服务)   │
                    └──────┬───────┘
                           │ DATABASE_URL
                           ▼
                    ┌──────────────┐
                    │   HAProxy    │  ← 连接路由层（2副本）
                    │  :5432 写    │
                    │  :5433 读    │
                    └──────┬───────┘
                           │ Patroni REST API
            ┌──────────────┼──────────────┐
            ▼              │              ▼
     ┌─────────────┐       │       ┌─────────────┐
     │  patroni-1  │       │       │  patroni-2  │
     │  (PG 实例)  │       │       │  (PG 实例)  │
     │   S1/db-1   │       │       │   S2/db-2   │
     └──────┬──────┘       │       └──────┬──────┘
            │              │              │
            │     ┌────────┴────────┐     │
            │     │   etcd 集群     │     │
            └────►│ (3节点共识)     │◄────┘
                  │ S1 + S2 + S3   │
                  └────────────────┘
```

### 新增 3 类基础设施服务

| 服务 | 副本数 | 部署位置 | 作用 |
|------|--------|----------|------|
| etcd-1 / etcd-2 / etcd-3 | 各 1 | S1(db-1) / S2(db-2) / S3(gateway) | 分布式共识，存储集群状态，Leader 选举 |
| patroni-1 / patroni-2 | 各 1 | S1(db-1) / S2(db-2) | 管理 PG 实例生命周期，执行主从切换 |
| haproxy | 2 | Manager 节点均匀分布 | TCP 连接路由，通过健康检查自动跟随 Leader |

---

## 三、各组件的工作原理

### 3.1 etcd — 谁是 Leader 的唯一真相源

etcd 是一个分布式键值存储，使用 **Raft 共识算法** 保证强一致性。

在本架构中，etcd 的唯一职责是存储一个关键信息：

```
/ecom/ecom-pg/leader → "patroni-1"   （或 "patroni-2"）
```

这个 key 带有 **TTL（租约）**，Patroni Leader 必须每隔 `loop_wait`（10秒）续约一次。如果 Leader 节点宕机无法续约，TTL 到期后这个 key 自动消失，触发新一轮选举。

**为什么需要 3 个节点？**

Raft 算法要求 **多数派（quorum）** 才能达成共识：

- 3 节点集群，quorum = 2，可容忍 1 个节点故障
- 如果只有 2 个 etcd 节点，任一宕机就失去 quorum，整个集群无法选举
- 正好利用 3 个 Manager 节点（S1、S2、S3），每个节点跑一个 etcd

### 3.2 Patroni — PG 实例的自动驾驶仪

Patroni 是一个 Python 进程，运行在每个 PG 实例旁边，负责：

#### 启动阶段

```
patroni-1 启动：
  1. 检查 /var/lib/postgresql/data 是否有数据
  2. 有数据 → 启动 PG，尝试获取 etcd Leader 锁
  3. 无数据 → 从当前 Leader 做 pg_basebackup，作为 Replica 加入

patroni-2 启动：
  1. 同样检查数据目录
  2. 如果 patroni-1 已经是 Leader，自动做 pg_basebackup 成为 Replica
```

#### 运行阶段（心跳循环）

```python
# 伪代码 — Patroni 的核心循环
while True:
    if i_am_leader:
        # 续约 etcd Leader 锁（TTL 30s 内必须续约）
        etcd.refresh_leader_lock(ttl=30)
        # 确保 PG 以 Primary 模式运行
        ensure_pg_is_primary()
    else:
        # 检查 Leader 锁是否还存在
        if not etcd.leader_exists():
            # Leader 消失！尝试竞选
            if etcd.try_acquire_leader_lock():
                # 我赢了选举 → 提升为 Primary
                pg_promote()
        else:
            # Leader 正常，确保我是 Replica
            ensure_pg_is_replica()

    sleep(loop_wait=10)  # 每 10 秒检查一次
```

#### 故障转移时序

```
T+0s    S1 宕机，patroni-1 停止心跳
T+10s   patroni-2 的下一个 loop_wait 周期开始
T+20s   etcd Leader 锁的 TTL（30s）接近到期
T+30s   etcd Leader 锁过期，key 消失
T+30s   patroni-2 检测到无 Leader，尝试获取锁
T+31s   patroni-2 获取锁成功，执行 pg_promote()
T+32s   S2 的 PG 从 Replica 提升为 Primary
T+35s   HAProxy 健康检查发现 patroni-2 的 /primary 返回 200
        → 流量自动切到 S2
```

**总耗时：约 30-35 秒**（TTL 30s + 检测延迟）

### 3.3 HAProxy — 应用无感知的连接路由

HAProxy 是一个 TCP 代理，应用服务只需连接 `haproxy:5432`，不需要知道谁是 Primary。

#### 健康检查原理

```
HAProxy 每 3 秒检查一次：

GET http://patroni-1:8008/primary → 200（我是 Leader）或 503（我是 Replica）
GET http://patroni-2:8008/primary → 200 或 503

只有返回 200 的节点才会收到流量
```

Patroni 内置了 REST API（端口 8008），提供以下端点：

| 端点 | 含义 |
|------|------|
| `GET /primary` | 如果是 Leader 返回 200，否则 503 |
| `GET /replica` | 如果是 Replica 返回 200，否则 503 |
| `GET /health` | 节点健康则 200 |

HAProxy 的两个监听端口利用了这一点：

```
端口 5432（pg_primary）→ 检查 /primary → 只路由到 Leader 节点（读写）
端口 5433（pg_replica）→ 检查 /replica → 只路由到 Replica 节点（只读，预留读写分离）
```

#### 故障转移期间的连接行为

```
1. patroni-1 宕机 → HAProxy 对 patroni-1 的健康检查失败
2. 经过 fall=3 次失败（3×3s=9s），HAProxy 标记 patroni-1 为 DOWN
3. patroni-2 被提升为 Primary → /primary 开始返回 200
4. 经过 rise=2 次成功（2×3s=6s），HAProxy 标记 patroni-2 为 UP
5. 新连接自动路由到 patroni-2
```

已有的活跃连接会断开（TCP 对端消失），应用需要有**重连机制**（Drizzle ORM 默认支持）。

---

## 四、关键配置参数解释

### 4.1 故障检测时间参数

```yaml
# patroni.yml
ttl: 30           # Leader 锁的 TTL（秒）
loop_wait: 10     # Patroni 心跳周期（秒）
retry_timeout: 10 # 选举超时（秒）
```

**权衡**：
- 更小的 TTL → 更快检测故障，但网络抖动可能导致误切换
- 更大的 TTL → 更稳定，但故障恢复更慢
- 30s TTL + 10s loop 是 Patroni 社区推荐的平衡值

### 4.2 数据安全参数

```yaml
maximum_lag_on_failover: 1048576  # 1MB
```

如果 Replica 落后 Leader 超过 1MB 的 WAL 日志，Patroni **不会**将其提升为新 Leader。这避免了数据丢失，但意味着如果两个节点都不满足条件，集群会进入只读状态直到人工干预。

```yaml
use_pg_rewind: true
```

旧 Leader 恢复后，使用 `pg_rewind` 快速倒回到新 Leader 的时间线，避免重新做完整的 `pg_basebackup`。这将恢复时间从"分钟级"缩短到"秒级"。

### 4.3 HAProxy 健康检查参数

```
inter 3s    # 每 3 秒检查一次
fall 3      # 连续 3 次失败标记为 DOWN（9秒检测窗口）
rise 2      # 连续 2 次成功标记为 UP（6秒恢复窗口）
```

---

## 五、与旧架构的对比

| 维度 | 旧架构 | 新架构 |
|------|--------|--------|
| 主从角色 | 硬编码（标签 db-primary/db-replica） | 动态（Patroni 选举，标签改为 db-1/db-2） |
| 故障转移 | 人工 SSH → promote → 改配置 → 重启 | 自动，30 秒内完成 |
| 应用连接 | `postgres-primary:5432`（DNS 硬绑定） | `haproxy:5432`（自动跟随 Leader） |
| 复制配置 | 手动脚本 `pg-init-replication.sh` | Patroni 自动管理 |
| 旧主恢复 | 手动重建 Replica | 自动 `pg_rewind` 重新加入 |
| 新增组件 | 无 | etcd ×3 + Patroni ×2 + HAProxy ×2 |
| 额外资源 | 无 | etcd ~256MB×3 + HAProxy ~128MB×2 ≈ 1GB |

---

## 六、数据流向图

### 正常状态

```
用户请求
  │
  ▼
Caddy (:443)
  │
  ▼
api-gateway (:3000)
  │
  ├─ user-service (:3001) ──┐
  ├─ product-service (:3002)─┤
  ├─ cart-service (:3003) ──┤    DATABASE_URL
  └─ order-service (:3004) ─┤
                             ▼
                      HAProxy (:5432)
                             │
                   ┌─────────┴─────────┐
                   ▼ ✅ Leader          ▼ Replica
              patroni-1 (S1)      patroni-2 (S2)
                   │                    ▲
                   └── WAL 流复制 ───────┘
```

### S1 宕机后（自动切换后）

```
                      HAProxy (:5432)
                             │
                   ┌─────────┴─────────┐
                   ▼ ❌ DOWN           ▼ ✅ 新 Leader
              patroni-1 (S1)      patroni-2 (S2)
              （宕机）              （已提升）
```

### S1 恢复后

```
                      HAProxy (:5432)
                             │
                   ┌─────────┴─────────┐
                   ▼ Replica            ▼ ✅ Leader
              patroni-1 (S1)      patroni-2 (S2)
                   ▲                    │
                   └── WAL 流复制 ───────┘
              （pg_rewind 后作为 Replica 重新加入）
```

---

## 七、文件变更清单

### 新增文件

| 文件 | 作用 |
|------|------|
| `infra/patroni/Dockerfile` | 基于 `postgres:16-alpine`，安装 Patroni + etcd3 客户端 |
| `infra/patroni/entrypoint.sh` | 从 Docker Secrets 读取密码，启动 Patroni 进程 |
| `infra/patroni/patroni.yml` | Patroni 核心配置：etcd 地址、PG 参数、认证、故障检测 |
| `infra/patroni/post-init.sh` | 集群首次初始化时创建 3 个微服务 Schema |
| `infra/haproxy/haproxy.cfg` | TCP 代理配置：5432 写、5433 读、7000 监控 |

### 修改文件

| 文件 | 变更内容 |
|------|----------|
| `infra/swarm/docker-stack.yml` | 移除 postgres-primary/replica，新增 etcd×3 + patroni×2 + haproxy；所有 DATABASE_URL 改为 `haproxy:5432`；Redis 约束改为 db-1/db-2 |
| `infra/swarm/deploy.sh` | 标签 db-primary/db-replica → db-1/db-2；新增 replication_password Secret |
| `.github/workflows/deploy.yml` | 构建矩阵新增 patroni 镜像 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `infra/swarm/pg-init-replication.sh` | Patroni 自动处理复制配置 |
| `infra/swarm/pg-replica.conf` | Replica 的 PG 参数由 Patroni 统一管理 |

---

## 八、迁移步骤

> 针对已有生产数据的在线迁移

```bash
# 1. 备份（安全第一）
docker exec $(docker ps -q -f name=ecom_postgres-primary) \
  pg_dump -U postgres ecommerce > backup_$(date +%Y%m%d).sql

# 2. 在旧主库创建复制用户（Patroni 需要）
docker exec $(docker ps -q -f name=ecom_postgres-primary) \
  psql -U postgres -c "CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '<密码>';"

# 3. 创建新 Docker Secret
echo -n "<与上面相同的密码>" | docker secret create replication_password -

# 4. 更新节点标签
docker node update --label-rm role <S1-hostname>
docker node update --label-add role=db-1 <S1-hostname>
docker node update --label-rm role <S2-hostname>
docker node update --label-add role=db-2 <S2-hostname>

# 5. SCP 新配置到服务器
scp -r infra/ user@swarm-manager:/opt/ecom/

# 6. 部署（docker stack deploy 是幂等的）
cd /opt/ecom/infra/swarm
REGISTRY=ghcr.io/your-org TAG=latest \
  docker stack deploy -c docker-stack.yml --with-registry-auth ecom

# 7. 验证
docker exec $(docker ps -q -f name=ecom_patroni-1) patronictl list
```

### 预计停机时间：2-5 分钟

---

## 九、故障转移验证

```bash
# 模拟 S1 宕机
docker service scale ecom_patroni-1=0

# 观察（30秒内 patroni-2 应提升为 Leader）
watch -n2 'docker exec $(docker ps -q -f name=ecom_patroni-2) patronictl list'

# 验证应用仍可访问
curl -X POST https://api.find345.site/health

# 恢复 S1（自动作为 Replica 重新加入）
docker service scale ecom_patroni-1=1
```
