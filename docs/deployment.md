# 部署指南

## 1. 前置要求

- Docker 24+ / Docker Compose V2
- 至少 2GB RAM
- 域名（可选，Caddy 支持自动 HTTPS）

## 2. 快速启动

```bash
# 克隆项目
git clone <repo-url> && cd my-backend

# 配置环境变量
cp .env.example .env
# 编辑 .env 修改 JWT secrets 和密码

# 一键启动
docker compose up -d --build

# 检查服务状态
docker compose ps

# 健康检查
curl -s -X POST http://localhost/health | jq .
```

## 3. 首次初始化

```bash
# 运行数据库迁移
docker compose exec api-gateway bun run packages/database/src/migrate.ts

# 插入种子数据（开发环境）
docker compose exec api-gateway bun run packages/database/src/seed.ts

# 验证
curl -s -X POST http://localhost/api/v1/product/list \
  -H "Content-Type: application/json" \
  -d '{"page":1}' | jq .
```

## 4. 环境变量说明

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `POSTGRES_PASSWORD` | 是 | `postgres` | PG 密码（生产环境必须修改） |
| `JWT_ACCESS_SECRET` | 是 | `dev-access-secret-change-me` | Access Token 签名密钥（>=16 字符） |
| `JWT_REFRESH_SECRET` | 是 | `dev-refresh-secret-change-me` | Refresh Token 签名密钥（>=16 字符） |
| `INTERNAL_SECRET` | 是 | `dev-internal-secret` | 服务间通信密钥（>=8 字符） |
| `NODE_ENV` | 否 | `production` | 环境标识 |
| `JWT_ACCESS_EXPIRES_IN` | 否 | `15m` | Access Token 有效期 |
| `JWT_REFRESH_EXPIRES_IN` | 否 | `7d` | Refresh Token 有效期 |

## 5. 生产环境配置

### 5.1 启用 HTTPS

编辑 `infra/caddy/Caddyfile`：

```caddyfile
# 删除 auto_https off 行
# 将 :80 替换为域名
your-domain.com {
    reverse_proxy api-gateway:3000
    # Caddy 自动签发 Let's Encrypt 证书
}
```

### 5.2 修改密码

```bash
# .env
POSTGRES_PASSWORD=<strong-random-password>
JWT_ACCESS_SECRET=<random-string-32-chars>
JWT_REFRESH_SECRET=<random-string-32-chars>
INTERNAL_SECRET=<random-string-16-chars>
```

### 5.3 PG 调优

根据实例规格编辑 `infra/postgres/postgresql.conf`：

| 参数 | 2GB | 4GB | 8GB |
|------|-----|-----|-----|
| `shared_buffers` | 512MB | 1GB | 2GB |
| `effective_cache_size` | 1.5GB | 3GB | 6GB |
| `work_mem` | 8MB | 16MB | 32MB |
| `maintenance_work_mem` | 128MB | 256MB | 512MB |

## 6. 运维手册

```bash
# 查看日志
docker compose logs -f                    # 全部
docker compose logs -f api-gateway         # 单个服务

# 重启服务
docker compose restart product-service

# 数据库迁移
docker compose exec api-gateway bun run packages/database/src/migrate.ts

# 库存对账（只读）
docker compose exec product-service bun run scripts/stock-sync.ts

# 库存对账（强制同步）
docker compose exec product-service bun run scripts/stock-sync.ts --forceSync

# 缓存清理
docker compose exec redis redis-cli FLUSHDB

# 冒烟测试
bash scripts/smoke-test.sh http://localhost:80

# 压测
bun run scripts/stress-test.ts 100 http://localhost:80
```

## 7. 架构拓扑

```
Caddy :80/:443 (TLS termination)
    |
API Gateway :3000 (Hono)
    |-- User Service :3001      --> PG + Redis
    |-- Product Service :3002   --> PG + Redis (Lua scripts)
    |-- Cart Service :3003      --> Redis only
    |-- Order Service :3004     --> PG + Redis
    |
PostgreSQL :5432 (3 schemas: user_service, product_service, order_service)
Redis :6379 (cache, stock, cart, locks, queues)
```

## 8. 故障排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 服务一直 unhealthy | 依赖的 PG/Redis 未就绪 | `docker compose ps` 确认 infra 健康 |
| `getConfig()` 报错 | 缺少环境变量 | 检查 docker-compose.yml 中的 environment |
| 连接 PG 超时 | max_connections 不足 | 调大 `postgresql.conf` 中的 `max_connections` |
| Redis WRONGTYPE 错误 | key 类型冲突 | `FLUSHDB` 清理后重启 |
| 内部接口 403 | `INTERNAL_SECRET` 不一致 | 确保所有服务使用相同的密钥 |
| 库存漂移 | Redis/DB 不一致 | 运行 `stock-sync.ts --forceSync` |
