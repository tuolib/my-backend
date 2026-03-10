# Docker Swarm 部署手册

5 台 Vultr VPS 的生产部署方案，PostgreSQL + Redis 高可用，GitHub Actions 自动部署。

## 架构概览

| 节点 | Swarm 角色 | 标签 | 固定服务 |
|------|-----------|------|---------|
| S1 | Manager | `role=db-primary` | Patroni(PG) + etcd + Redis 主 + Sentinel |
| S2 | Manager | `role=db-replica` | Patroni(PG) + etcd + Redis 从 + Sentinel |
| S3 | Manager | `role=gateway` | Certbot + etcd + Sentinel + Prometheus + Grafana |
| S4 | Worker | — | 应用微服务（优先调度） |
| S5 | Worker | — | 应用微服务（优先调度） |

应用服务不绑定 Worker 节点，资源不足时 Swarm 自动溢出到 Manager 节点。

## 一次性操作

### 1. 创建服务器

在 Vultr 创建 5 台 VPS（建议 2GB+ 内存），选择同一 VPC、同一 SSH Key。

### 2. 初始化集群

SSH 到 S1，运行一条命令：

```bash
# 下载 init-node.sh（或从仓库 clone）
curl -O https://raw.githubusercontent.com/YOUR_REPO/main/infra/swarm/init-node.sh

# 替换为 5 台服务器的内网 IP
bash init-node.sh 10.0.0.1 10.0.0.2 10.0.0.3 10.0.0.4 10.0.0.5
```

脚本自动完成：
- 所有节点安装 Docker + 防火墙
- 初始化 Swarm 集群（3 Manager + 2 Worker）
- 分配节点标签
- 创建自签名 SSL 证书
- 配置 Docker 垃圾清理和 PG 备份 cron

### 3. 配置 GitHub Secrets

| Secret | 说明 |
|--------|------|
| `SWARM_SSH_KEY` | SSH 私钥（ed25519 推荐） |
| `GHCR_PAT` | GitHub Container Registry 访问令牌 |
| `SWARM_POSTGRES_PASSWORD` | PostgreSQL 超级用户密码 |
| `SWARM_REPLICATION_PASSWORD` | PG 复制用户密码 |
| `SWARM_JWT_ACCESS_SECRET` | JWT Access Token 密钥 |
| `SWARM_JWT_REFRESH_SECRET` | JWT Refresh Token 密钥 |
| `SWARM_INTERNAL_SECRET` | 内部服务通信密钥 |

### 4. 配置 GitHub Variables

| Variable | 说明 | 示例 |
|----------|------|------|
| `SWARM_HOST` | S1 的公网 IP | `149.28.xxx.xxx` |
| `SWARM_USER` | SSH 用户 | `root` |
| `SWARM_DOMAIN` | 域名 | `api.example.com` |
| `SWARM_EMAIL` | Let's Encrypt 邮箱 | `admin@example.com` |

### 5. 配置 DNS

将域名的 A 记录指向所有 5 台节点的公网 IP。Swarm ingress mesh 会将流量路由到 Nginx 所在节点。

```
api.example.com  A  149.28.x.1
api.example.com  A  149.28.x.2
api.example.com  A  149.28.x.3
api.example.com  A  149.28.x.4
api.example.com  A  149.28.x.5
```

## 日常操作

### 部署

Push 代码到 main 或手动触发 GitHub Actions（选择 platform = `swarm`），全自动完成：
1. 构建 6 个镜像（5 微服务 + patroni）
2. SSH 到 S1 执行 `docker stack deploy`
3. 等待服务收敛
4. Schema 迁移 + Data 迁移 + Seed
5. Smoke test（健康检查，失败自动回滚）

### 运维命令

在 S1 上运行 `ops.sh`：

```bash
# 查看所有服务状态
bash ops.sh status

# 查看服务日志
bash ops.sh logs api-gateway

# 回滚服务到上一版本
bash ops.sh rollback api-gateway

# 强制重启服务（如加载新 SSL 证书）
bash ops.sh reload nginx

# 扩缩容
bash ops.sh scale api-gateway 3
```

## 高可用机制

### PostgreSQL

```
应用 → data-proxy (HAProxy :5432) → Patroni Primary
                                      ↕
                                etcd (3 节点投票)
```

S1 宕机 → etcd 2/3 投票 → Patroni 提升 S2 为主 → HAProxy 自动切换 → 用户无感知

### Redis

```
应用 → data-proxy (HAProxy :6379) → Redis Master
                                      ↕
                                Sentinel (3 节点投票)
```

S1 宕机 → Sentinel 2/3 投票 → 提升 S2 Redis 为主 → HAProxy 自动切换 → 用户无感知

### Nginx

```
用户 → DNS 轮询 → Swarm ingress mesh → Nginx (replicas=2)
```

任意一台挂了，ingress mesh 自动将流量路由到另一台。

## 监控

Grafana 面板：`https://your-domain.com/grafana/`（默认账号 admin/admin）

- Node Exporter：每台节点 CPU/内存/磁盘/网络
- cAdvisor：每个容器资源使用
- HAProxy Stats：`http://S1_IP:8404/stats`（内网访问）

## 备份

- 每天 02:00 自动 `pg_dump` 全量备份
- 保留最近 7 天，自动清理
- 备份文件在 Patroni 主节点容器内 `/var/lib/postgresql/backups/`

## 文件清单

```
infra/swarm/
├── docker-stack.yml          # Stack 定义（22 个服务）
├── init-node.sh              # 一键初始化集群
├── ops.sh                    # 运维工具
├── nginx.conf                # 反向代理 + SSL
├── certbot-entrypoint.sh     # SSL 自动签发 & 续签
├── app-entrypoint.sh         # 应用入口（Secret → 环境变量）
├── Dockerfile.patroni        # PostgreSQL 16 + Patroni 镜像
├── patroni.yml               # Patroni 配置
├── patroni-entrypoint.sh     # Patroni 启动入口
├── patroni-post-bootstrap.sh # 首次引导后创建数据库
├── haproxy-data.cfg          # PG + Redis 连接代理
├── redis-sentinel.conf       # Sentinel 配置
├── prometheus.yml            # Prometheus 采集配置
├── pg-backup.sh              # 数据库定时备份
```
