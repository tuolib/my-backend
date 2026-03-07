# Docker Swarm 部署方案 — Claude Code CLI 提示词

## 目标

为电商微服务平台设计 Docker Swarm 生产部署方案。

## 约束

- 5 台 Vultr VPS（S1-S5），同一 VPC 内网互通
- 用户操作极简：只需 SSH 到 S1 跑一条命令初始化集群，其余全部由 GitHub Actions 自动完成
- 高可用：主数据库宕机后自动切换，用户无感知
- 业务代码零改动：所有 HA 在基础设施层实现

## 节点规划

| 节点 | Swarm 角色 | 标签 | 固定服务 | 弹性服务 |
|------|-----------|------|---------|---------|
| S1 | Manager | `role=db-primary` | Patroni(PG) + etcd + Redis 主 + Sentinel | 可接收应用溢出 |
| S2 | Manager | `role=db-replica` | Patroni(PG) + etcd + Redis 从 + Sentinel | 可接收应用溢出 |
| S3 | Manager | `role=gateway` | Certbot + etcd + Sentinel | 可接收应用溢出 |
| S4 | Worker | 无 | — | 应用微服务（优先） |
| S5 | Worker | 无 | — | 应用微服务（优先） |

应用服务**不设 `node.role == worker` 约束**，Swarm 可调度到任意节点。通过 `resources.reservations` 确保数据库服务的资源不被挤占。当 S4/S5 资源不足时，Swarm 会自动将多出的副本调度到 S1/S2/S3。

## 网络隔离（3 层 overlay）

- `public_net` — Nginx ↔ API Gateway（DMZ）
- `service_net` — API Gateway ↔ 微服务（内部通信）
- `data_net`（internal: true）— 微服务 ↔ PG/Redis/etcd（外部不可达）

## PostgreSQL 高可用

使用 Patroni + etcd + HAProxy：

```
应用 → pg-proxy (HAProxy :5432) → 当前 Patroni Primary
                                    ↕
                              etcd 集群 (3 节点投票)
```

- etcd 3 节点分布在 S1/S2/S3，分布式共识防脑裂
- Patroni 管理 PG 主从，自动故障转移 ~10 秒完成
- data-proxy (HAProxy) 通过 Patroni REST API 检测主节点，自动路由
- 应用 DATABASE_URL 指向 `data-proxy:5432`，不感知主从切换

故障场景：S1 宕机 → etcd 2/3 投票确认 → Patroni 提升 S2 为主 → HAProxy 自动切换 → 用户无感知

## Redis 高可用

使用 Sentinel + HAProxy，与 PG 方案对称：

```
应用 → data-proxy (HAProxy :6379) → 当前 Redis Master
                                       ↕
                                 Sentinel (3 节点投票)
```

- Redis Sentinel 3 节点分布在 S1/S2/S3（与 etcd 共用 Manager 节点）
- Sentinel 检测主库故障，自动提升从库为主库
- data-proxy (HAProxy) 通过 TCP 健康检查（`INFO replication` → `role:master`）路由到当前主库
- 应用 REDIS_URL 指向 `data-proxy:6379`，不感知主从切换
- PG 和 Redis 共用同一个 HAProxy 实例（data-proxy），PG 在 :5432，Redis 在 :6379

故障场景：S1 宕机 → Sentinel 2/3 投票确认 → 提升 S2 Redis 为主 → HAProxy 自动切换 → 用户无感知

## Nginx 高可用 + SSL

通过 Docker Secret 存储证书，解除 Nginx 与 Certbot 的本地卷绑定，实现 Nginx 多节点部署：

```
用户 → DNS 轮询 (S3/S4/S5) → Swarm ingress mesh → nginx (replicas=2, 任意节点)
```

- Certbot 在 S3（gateway 节点）运行，申请/续签证书后写入 Docker Secret
- Nginx 从 Docker Secret 读取证书，不依赖本地卷，可调度到任意节点
- `replicas: 2` + ingress mesh = 任意一台挂了，流量自动走另一台
- 首次启动生成自签名证书（让 Nginx 能立即启动 443）
- Certbot 每 12 小时检查续签，续签后更新 Secret 并触发 Nginx 滚动重启

## CI/CD（GitHub Actions）

触发：手动选择 platform=swarm → 构建 6 个镜像（5 微服务 + patroni）→ SSH 到 S1 自动完成：
1. 节点标签自动分配（按 Node ID，hostname 重复也安全）
2. Docker Secrets 创建（幂等）
3. `docker stack deploy`（首次/滚动更新）
4. 等待服务收敛
5. Schema 迁移 + Data 迁移 + Seed

## 用户操作清单

### 一次性操作

1. 生成 SSH Key
2. Vultr 创建 5 台服务器（同一 SSH Key）
3. SSH 到 S1，跑一条命令：`bash init-node.sh <S1> <S2> <S3> <S4> <S5>`（自动装 Docker、防火墙、初始化 Swarm、加入所有节点）
4. 配置 GitHub Secrets（SSH 私钥、GHCR PAT、数据库密码、JWT 密钥）
5. 配置 GitHub Variables（SWARM_HOST、SWARM_USER、域名、邮箱）
6. DNS A 记录指向所有 5 台节点（ingress mesh 会路由到 nginx 所在节点）

### 日常操作

Push 代码或手动触发 GitHub Actions，全自动部署。

## 需要生成的文件

```
infra/swarm/
├── docker-stack.yml          # Stack 定义（所有服务）
├── init-node.sh              # 一键初始化集群脚本
├── ops.sh                    # 运维工具（status/logs/rollback/reload/scale）
├── nginx.conf                # 反向代理 + SSL 终结
├── certbot-entrypoint.sh     # SSL 自动签发 & 续签
├── app-entrypoint.sh         # 应用共享入口（读 Secret → 注入环境变量）
├── Dockerfile.patroni        # PostgreSQL 16 + Patroni 镜像
├── patroni.yml               # Patroni 配置
├── patroni-entrypoint.sh     # Patroni 启动入口（读 Secret）
├── patroni-post-bootstrap.sh # 首次引导后创建数据库和 Schema
├── haproxy-data.cfg          # PG + Redis 连接代理配置（合并）
├── redis-sentinel.conf       # Redis Sentinel 配置

infra/postgres/
├── postgresql.conf           # PG 调优（本地开发用）
├── init.sql                  # Schema 初始化（本地开发用）

infra/redis/
├── redis.conf                # Redis 调优

.github/workflows/
├── deploy.yml                # CI/CD（含 swarm 部署 job）

docs/
├── swarm-setup.md            # 用户操作手册
```

## 服务总览（18 个）

| 类别 | 服务 | 数量 | 部署位置 |
|------|------|------|---------|
| PG HA | etcd-1, etcd-2, etcd-3 | 3 | S1/S2/S3 各一个 |
| PG HA | patroni-1, patroni-2 | 2 | S1, S2 |
| Redis | redis-primary, redis-replica | 2 | S1, S2 |
| Redis HA | redis-sentinel | 3 | S1/S2/S3 各一个 |
| 数据代理 | data-proxy (HAProxy) | 1 | 任意节点 |
| 网关 | nginx (replicas=2) | 2 | 任意节点（Swarm 调度） |
| SSL | certbot | 1 | S3 (gateway) |
| 应用 | api-gateway, user/product/cart/order-service | 5 | S4/S5 |

- PG + Redis 共用一个 data-proxy（HAProxy 多端口监听）
- Nginx 多副本，证书通过 Docker Secret 共享，不绑定特定节点

## ops.sh 命令

仅保留运维调试命令，不与 GitHub Actions 重叠：

```
ops.sh status            # 服务状态 + 节点列表 + 最近失败
ops.sh logs <service>    # 查看服务日志（tail -f）
ops.sh rollback <service># 回滚到上一版本
ops.sh reload <service>  # 强制重启（如 reload nginx 加载新证书）
ops.sh scale <service> N # 扩缩容
```

不包含 deploy、migrate、setup、init、destroy（这些由 GitHub Actions 或 init-node.sh 处理）。

## 设计原则

- 不写用不到的功能（如 PG 读代理）
- 不重复（ops.sh 和 GitHub Actions 不能有功能重叠）
- 锚点只在 3 处以上复用时才创建
- 每个文件头部注释说明用途
- 所有配置通过 GitHub Secrets/Variables 管理，服务器上不存任何密码
- 应用服务不绑定 Worker 节点，依靠资源预留（reservations）防止挤占数据库，允许 Swarm 在所有节点间弹性调度
