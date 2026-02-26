# Docker Swarm 本地开发手册（多 API + 多数据库）

这份文档优先服务“本地开发同构演练”：在本地或内网环境复现生产形态的多实例 API、PostgreSQL 主从、PgBouncer 与网关。

能力范围：
- 单机模式：`1` 节点 manager，`1` 主库 + `1` 从库，API 默认 `2` 副本
- 多机模式：`10` API 节点 + `10` DB 节点（`1` 主 `9` 从），API 默认 `10` 副本
- Caddy 网关（80/443）
- PgBouncer（读写分离连接池）
- HAProxy（只读流量转发到从库）
- Redis

核心文件：
- `swarm/stack.yml`
- `swarm/stack-single.yml`
- `swarm/.env.example`
- `swarm/caddy/Caddyfile`
- `swarm/haproxy/haproxy-ro.cfg`
- `swarm/haproxy/haproxy-ro-single.cfg`
- `scripts/swarm/*.sh`

<a id="swarm-local-overview"></a>
## 1. 本地开发总览（架构与流量）

目标：先明确单机/多机下服务怎么连，后续排错更快。

请求链路：
1. 外部请求 -> Caddy（`80/443`）
2. Caddy -> `api` 服务（Swarm VIP）
3. API 写请求 -> `pgbouncer-rw` -> `postgres-primary`
4. API 读请求 -> `pgbouncer-ro` -> `haproxy-ro` -> `postgres-replica-*`

关键默认值（来自 `swarm/.env.example`）：
- `DEPLOY_MODE=auto`
- `API_REPLICAS_SINGLE=2`
- `API_REPLICAS_MULTI=10`
- `RUN_MIGRATION=true`

说明：
- `DEPLOY_MODE=auto` 时，`scripts/swarm/deploy-stack.sh` 会自动判断节点数。
- `RUN_MIGRATION=true` 时，部署脚本会在发布后自动执行 `bun run migrate`。

## 2. 前置准备（本地）

目标：确保 Swarm 与网络条件可用。

### 2.1 环境检查

```bash
docker version
docker info --format '{{.Swarm.LocalNodeState}}'
```

预期：
- Docker 可用
- Swarm 状态若为 `inactive`，需要先初始化（下一节）

### 2.2 端口与网络

多机时，节点间至少放通：
- `2377/tcp`（Swarm 管理）
- `7946/tcp`、`7946/udp`（节点通信）
- `4789/udp`（Overlay 网络）
- `80/tcp`、`443/tcp`（业务入口）

### 2.3 初始化 manager

```bash
bash scripts/swarm/init-manager.sh
```

预期：
- 输出 manager / worker join token
- `docker node ls` 可看到当前 manager

<a id="swarm-local-single"></a>
## 3. 单机本地演练（最快跑通）

目标：在 1 台机器上跑通“多 API + 主从 DB + 读写分离”。

### 3.1 准备配置

```bash
cp swarm/.env.example swarm/.env.swarm
```

建议最小改动：

```dotenv
DEPLOY_MODE=single
STACK_NAME=ho
SWARM_DOMAIN=api.find345.site
IMAGE_REPOSITORY=ghcr.io/your-org/ho-api
IMAGE_TAG=latest
POSTGRES_PASSWORD=password
POSTGRES_REPLICATION_PASSWORD=repl_password
JWT_SECRET=change-me-in-prod
RUN_MIGRATION=true
```

说明：
- 本地如果没有公网域名，可继续用 `SWARM_DOMAIN=api.find345.site`，测试时通过 `Host` 头访问。

### 3.2 执行部署

```bash
bash scripts/swarm/deploy-stack.sh
```

预期：
- 自动选择 `swarm/stack-single.yml`
- 核心服务 Ready：`postgres-primary`、`postgres-replica-1`、`pgbouncer-rw`、`pgbouncer-ro`、`api`、`caddy`
- 如 `RUN_MIGRATION=true`，会自动执行迁移

### 3.3 验证服务状态

```bash
docker stack services ho
docker service ls
```

单机默认期望：
- `ho_api`：`2/2`
- `ho_postgres-primary`：`1/1`
- `ho_postgres-replica-1`：`1/1`

### 3.4 验证网关与健康检查

```bash
curl -i -H 'Host: api.find345.site' http://127.0.0.1/healthz
curl -i -H 'Host: api.find345.site' http://127.0.0.1/readyz
```

预期：
- `/healthz` 返回 `200`
- `/readyz` 返回 `200`

<a id="swarm-local-multi"></a>
## 4. 多机本地演练（10 API + 10 DB）

目标：在多节点环境复现完整多实例部署。

### 4.1 节点规划

建议：
- 1 个 manager（可同时承载少量服务）
- 10 个 API 节点
- 10 个 DB 节点

### 4.2 节点加入集群

在其他节点执行 `init-manager.sh` 输出的 join 命令，完成后在 manager 核对：

```bash
docker node ls
```

### 4.3 给节点打标签

部署约束依赖标签：
- API 节点：`tier=api` + `api_slot=1..10`
- DB 节点：`tier=db` + `db_slot=1..10`

示例：

```bash
API_NODES="api-01,api-02,api-03,api-04,api-05,api-06,api-07,api-08,api-09,api-10" \
DB_NODES="db-01,db-02,db-03,db-04,db-05,db-06,db-07,db-08,db-09,db-10" \
bash scripts/swarm/label-nodes.sh
```

查看标签：

```bash
docker node inspect $(docker node ls -q) --format '{{.Description.Hostname}} => {{.Spec.Labels}}'
```

如果要清空重打：

```bash
CLEAN=true bash scripts/swarm/label-nodes.sh
```

### 4.4 配置并部署

`.env.swarm` 关键项：

```dotenv
DEPLOY_MODE=multi
API_REPLICAS_MULTI=10
```

部署：

```bash
bash scripts/swarm/deploy-stack.sh
```

预期：
- 使用 `swarm/stack.yml`
- `ho_api` 目标副本 `10`
- DB 为 `1` 主 + `9` 从

### 4.5 多机验证

```bash
docker stack services ho
docker service ps ho_api --no-trunc
docker service ps ho_postgres-primary --no-trunc
docker service ps ho_postgres-replica-1 --no-trunc
```

如果副本未调度，优先检查：
- 节点标签是否齐全
- 节点是否 `Ready/Active`
- 资源是否充足（CPU/内存/磁盘）

<a id="swarm-db-ops"></a>
## 5. 数据库操作与验证（主从 + 读写分离）

目标：确认写入进入主库、读取走从库、复制链路正常。

下例假设：
- `STACK_NAME=ho`
- `POSTGRES_USER=user`
- `POSTGRES_PASSWORD=password`
- `POSTGRES_DB=mydb`

### 5.1 验证写路径（pgbouncer-rw -> primary）

```bash
docker run --rm --network ho_backend -e PGPASSWORD=password postgres:16-alpine \
  psql -h pgbouncer-rw -U user -d mydb -c "create table if not exists swarm_rw_test(id serial primary key, note text, created_at timestamptz default now());"

docker run --rm --network ho_backend -e PGPASSWORD=password postgres:16-alpine \
  psql -h pgbouncer-rw -U user -d mydb -c "insert into swarm_rw_test(note) values ('from-rw-1') returning id, note, created_at;"
```

预期：
- 建表、写入成功
- 返回新增记录

### 5.2 验证读路径（pgbouncer-ro -> replicas）

```bash
docker run --rm --network ho_backend -e PGPASSWORD=password postgres:16-alpine \
  psql -h pgbouncer-ro -U user -d mydb -c "select count(*) as total from swarm_rw_test;"
```

预期：
- 能读到刚写入的数据（可能存在轻微复制延迟）

### 5.3 验证当前连接落点（主/从）

写通道检查（应在主库）：

```bash
docker run --rm --network ho_backend -e PGPASSWORD=password postgres:16-alpine \
  psql -h pgbouncer-rw -U user -d mydb -c "select pg_is_in_recovery() as is_replica;"
```

读通道检查（应在从库，返回 `t`）：

```bash
docker run --rm --network ho_backend -e PGPASSWORD=password postgres:16-alpine \
  psql -h pgbouncer-ro -U user -d mydb -c "select pg_is_in_recovery() as is_replica;"
```

### 5.4 主库查看复制状态

```bash
PRIMARY_CID=$(docker ps --filter name=ho_postgres-primary --format '{{.ID}}' | head -n1)
docker exec -e PGPASSWORD=password "$PRIMARY_CID" psql -U user -d mydb -c \
"select application_name, client_addr, state, sync_state, write_lag, flush_lag, replay_lag from pg_stat_replication;"
```

预期：
- 至少 1 条 replica 连接记录（多机模式应有多条）
- `state` 常见为 `streaming`

### 5.5 从库确认只读模式

```bash
REPLICA_CID=$(docker ps --filter name=ho_postgres-replica-1 --format '{{.ID}}' | head -n1)
docker exec -e PGPASSWORD=password "$REPLICA_CID" psql -U user -d mydb -c \
"select pg_is_in_recovery() as is_replica, now() as replica_time;"
```

预期：
- `is_replica = t`

### 5.6 迁移策略（本地 Swarm）

部署脚本默认会做迁移：

```dotenv
RUN_MIGRATION=true
```

如果你要先发布后手动迁移，可设置：

```dotenv
RUN_MIGRATION=false
```

然后手动执行：

```bash
docker run --rm --network ho_backend \
  -e DATABASE_WRITE_URL="postgres://user:password@pgbouncer-rw:5432/mydb" \
  -e DATABASE_READ_URL="postgres://user:password@pgbouncer-ro:5432/mydb" \
  -e REDIS_URL="redis://redis:6379" \
  -e JWT_SECRET="change-me-in-prod" \
  -e DB_POOL_MAX="5" \
  -e DB_STRICT_READ_READINESS="false" \
  ghcr.io/your-org/ho-api:latest \
  bun run migrate
```

## 6. 日常操作清单

目标：常见动作有固定命令，减少误操作。

### 6.1 重新部署

```bash
bash scripts/swarm/deploy-stack.sh
```

### 6.2 API 扩缩容（覆盖默认副本）

```bash
API_REPLICAS=6 bash scripts/swarm/deploy-stack.sh
```

### 6.3 查看服务与任务

```bash
docker stack services ho
docker service ps ho_api
docker service logs ho_api --tail 100
```

### 6.4 下线

```bash
STACK_NAME=ho bash scripts/swarm/remove-stack.sh
```

## 7. 排错手册（按症状）

### 7.1 `api` 副本起不来

排查顺序：
1. `docker service ps ho_api --no-trunc`
2. `docker service logs ho_api --tail 200`
3. 检查 `DATABASE_*`、`JWT_SECRET` 是否正确
4. 多机场景确认 `tier=api` 标签是否存在

### 7.2 `postgres-replica-*` 起不来或没有跟上主库

排查顺序：
1. `docker service ps ho_postgres-primary --no-trunc`
2. `docker service ps ho_postgres-replica-1 --no-trunc`
3. 检查 `POSTGRES_REPLICATION_PASSWORD` 是否和主库初始化一致
4. 在主库执行 `select * from pg_stat_replication;`

### 7.3 读请求没有走从库

排查顺序：
1. `docker service ps ho_haproxy-ro --no-trunc`
2. `docker service ps ho_pgbouncer-ro --no-trunc`
3. 在 `pgbouncer-ro` 执行 `select pg_is_in_recovery();`，应返回 `t`

### 7.4 Caddy 健康检查失败

排查顺序：
1. `docker service ps ho_caddy --no-trunc`
2. `docker service logs ho_caddy --tail 200`
3. 本地 curl 使用 `Host` 头：

```bash
curl -i -H 'Host: api.find345.site' http://127.0.0.1/healthz
```

### 7.5 改了 Caddy/HAProxy 配置但不生效

说明：
- `deploy-stack.sh` 已内置 config 文件哈希逻辑。
- 每次配置文件内容变化会生成新 config 名称，重新部署即可生效。

## 8. 生产发布流程（保持原流程，不在本次改动范围）

工作流文件：`.github/workflows/deploy.yml`

现有流程：
1. `main` 分支 `push` 或手动触发后，执行 `bun install`、`bunx tsc --noEmit`、Docker Build。
2. 非 `pull_request` 场景推送镜像到 GHCR。
3. 在 self-hosted `swarm-manager` runner 上执行 `scripts/swarm/deploy-stack.sh`。
4. 发布后执行公网健康检查（`/healthz`）。

Runner 准备脚本（如需）：

```bash
GITHUB_REPOSITORY=<owner>/<repo> \
GH_TOKEN=<github_pat_or_fine_grained_token> \
bash scripts/github/setup-self-hosted-runner.sh
```

或使用 registration token：

```bash
GITHUB_REPOSITORY=<owner>/<repo> \
RUNNER_TOKEN=<registration_token> \
bash scripts/github/setup-self-hosted-runner.sh
```

## 9. 注意事项

- 当前 PostgreSQL 是主从流复制，默认不包含自动主库故障切换。
- 生产高可用建议额外引入主从自动切换方案（例如 Patroni/repmgr）。
- 生产网关高可用（双网关/LB/证书共享）需单独设计。
