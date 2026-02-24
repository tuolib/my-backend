# Docker Swarm 生产配置（多机 + 单机兼容）

这套配置支持两种模式：
- 多机模式：`10` 台 API 节点 + `10` 台 DB 节点（`1` 主 `9` 从）
- 单机模式：1 台 manager 机器也可直接发布成功（`1` 主 `1` 从）
- Caddy 网关（80/443）
- PgBouncer 读写连接池
- HAProxy 读库负载均衡
- Redis

核心文件：
- `swarm/stack.yml`
- `swarm/stack-single.yml`
- `swarm/.env.example`
- `swarm/caddy/Caddyfile`
- `swarm/haproxy/haproxy-ro.cfg`
- `swarm/haproxy/haproxy-ro-single.cfg`
- `scripts/swarm/*.sh`

## 1. 前置

每台服务器安装 Docker，且节点间网络互通：
- Swarm 管理端口：`2377/tcp`
- 节点通信：`7946/tcp`、`7946/udp`
- Overlay 网络：`4789/udp`
- 业务入口：`80/tcp`、`443/tcp`

## 2. 初始化 Swarm

在 manager 节点运行：

```bash
bash scripts/swarm/init-manager.sh
```

然后把 worker join 命令到其他节点执行。

## 3. 给节点打标签（仅多机模式）

如果是单机模式（`DEPLOY_MODE=single` 或 `auto` 且只有 1 个节点），可跳过本步骤。

本配置按标签调度：
- API 节点：`tier=api` + `api_slot=1..10`
- DB 节点：`tier=db` + `db_slot=1..10`

示例：

```bash
API_NODES="api-01,api-02,api-03,api-04,api-05,api-06,api-07,api-08,api-09,api-10" \
DB_NODES="db-01,db-02,db-03,db-04,db-05,db-06,db-07,db-08,db-09,db-10" \
bash scripts/swarm/label-nodes.sh
```

## 4. 配置环境变量

复制并修改：

```bash
cp swarm/.env.example swarm/.env.swarm
```

重点改这些：
- `DEPLOY_MODE`（`auto|single|multi`，默认 `auto`）
- `API_REPLICAS`（可选，显式指定副本数）
- `API_REPLICAS_SINGLE`（默认 `2`）
- `API_REPLICAS_MULTI`（默认 `10`）
- `IMAGE_REPOSITORY`
- `IMAGE_TAG`
- `SWARM_DOMAIN`
- `POSTGRES_PASSWORD`
- `POSTGRES_REPLICATION_PASSWORD`
- `JWT_SECRET`

模式说明：
- `DEPLOY_MODE=auto`：脚本自动判断，`1` 个 Swarm 节点走单机 stack，`>1` 节点走多机 stack
- `DEPLOY_MODE=single`：强制单机 stack
- `DEPLOY_MODE=multi`：强制多机 stack（需提前打好多机标签）
- API 副本默认值：单机 `2`、多机 `10`（可用 `API_REPLICAS` 覆盖）

## 5. 发布

在 manager 节点执行：

```bash
bash scripts/swarm/deploy-stack.sh
```

该脚本会：
1. 自动选择单机/多机 stack 并部署
2. 等待核心服务就绪
3. 自动执行迁移（`RUN_MIGRATION=true`）
4. 输出服务和端口信息

## 6. GitHub Actions 自动发布（无自定义 Secrets）

已提供工作流：`.github/workflows/deploy-swarm.yml`。

特点：
- `main` 分支 push 自动构建镜像并推送 GHCR
- 在 Swarm manager 上自动 `docker stack deploy`
- 域名、数据库密码等变量先“写死”在 workflow `env` 中（符合你当前“不配仓库 Secrets”的要求）
- 默认 `DEPLOY_MODE=auto`，同一套流水线可兼容单机和多机

使用前只需要做一件事：
- 在 Swarm manager 机器上安装 GitHub self-hosted runner，并加标签：`swarm-manager`

Runner 准备好后，push 到 `main` 即可自动发布。

## 7. 验证

```bash
docker stack services ho
docker service ls
curl -I http://api.finde345.site/healthz
curl -I https://api.finde345.site/healthz
```

## 8. 下线

```bash
STACK_NAME=ho bash scripts/swarm/remove-stack.sh
```

## 9. 注意事项

- 这是“工程可落地”的 Swarm 方案，不是等价替代 K8s 的完整生态。
- 数据库复制采用主从流复制，主故障自动切换不在本套默认实现里（生产建议引入 Patroni/repmgr）。
- 多机证书和网关高可用需要额外设计（如共享证书存储、双网关/LB）。
