# Phase 8: 部署 + 联调 + 性能调优（最终阶段）

## 前置条件
Phase 7 已完成。请先确认：
- 所有服务单独运行时测试全部通过
- Gateway 端到端 17 步全流程测试通过
- 本地 `docker compose up -d` 可启动 PG + Redis

## 本次任务
Docker 容器化全部服务、Caddy 反向代理、PG/Redis 调优、缓存预热、库存同步定时任务、冒烟测试脚本、压测脚本、部署文档。
完成后整个项目可一键 `docker compose up` 启动运行。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `CLAUDE.md`
- `docs/architecture.md` Phase 8 + 第 1.2 节（架构拓扑）+ 第 11.4 节（连接池配置）+ 第 12 章（安全清单）+ 第 8.3 节（库存同步机制）

### 第二步：创建通用 Dockerfile

**`infra/docker/Dockerfile.service`** — 所有服务共用的多阶段构建模板

```dockerfile
# ── Stage 1: Install dependencies ──
FROM oven/bun:1-alpine AS deps
WORKDIR /app

# 复制 workspace 配置
COPY package.json bun.lockb ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
# 服务自身 package.json 由 build arg 指定
ARG SERVICE_PATH
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/

RUN bun install --frozen-lockfile --production

# ── Stage 2: Build ──
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY version2 .

# 类型检查（可选，CI 中已做）
# RUN bun run --filter @repo/shared build
# RUN bun run --filter @repo/database build

# ── Stage 3: Production ──
FROM oven/bun:1-alpine AS runner
WORKDIR /app

# 安全：非 root 用户
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app .

USER appuser

ARG SERVICE_PORT=3000
EXPOSE ${SERVICE_PORT}

ARG SERVICE_ENTRY
CMD ["bun", "run", "${SERVICE_ENTRY}"]
```

实际上每个服务有细微差异，所以创建各自的 Dockerfile 更清晰：

**`apps/api-gateway/Dockerfile`**
**`services/user-service/Dockerfile`**
**`services/product-service/Dockerfile`**
**`services/cart-service/Dockerfile`**
**`services/order-service/Dockerfile`**

每个 Dockerfile 内容基本相同，差异仅在：
- EXPOSE 端口
- CMD 入口文件路径
- 需要的 packages（所有服务都依赖 shared + database）

建议模式：
```dockerfile
FROM oven/bun:1-alpine AS base
WORKDIR /app

# 复制整个 monorepo（利用 .dockerignore 排除无用文件）
COPY . .
RUN bun install --frozen-lockfile

# 非 root
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3001
CMD ["bun", "run", "services/user-service/src/index.ts"]
```

### 第三步：创建 .dockerignore

**`.dockerignore`**
```
node_modules
.git
.env
*.test.ts
__tests__
.DS_Store
docs/
*.md
!CLAUDE.md
```

### 第四步：创建完整 docker-compose.yml

**`docker-compose.yml`**（替换现有的仅 infra 版本）

```yaml
version: "3.9"

services:
  # ══════ 基础设施 ══════

  postgres:
    image: postgres:16-alpine
    container_name: ecom-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ecommerce
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
      - ./infra/postgres/postgresql.conf:/etc/postgresql/postgresql.conf
    command: postgres -c config_file=/etc/postgresql/postgresql.conf
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: ecom-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
      - ./infra/redis/redis.conf:/usr/local/etc/redis/redis.conf
    command: redis-server /usr/local/etc/redis/redis.conf
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    container_name: ecom-caddy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./infra/caddy/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      api-gateway:
        condition: service_healthy
    restart: unless-stopped

  # ══════ 应用服务 ══════

  api-gateway:
    build:
      context: .
      dockerfile: apps/api-gateway/Dockerfile
    container_name: ecom-gateway
    environment:
      - API_GATEWAY_PORT=3000
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ecommerce
      - JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
      - INTERNAL_SECRET=${INTERNAL_SECRET}
      - NODE_ENV=production
      - USER_SERVICE_URL=http://user-service:3001
      - PRODUCT_SERVICE_URL=http://product-service:3002
      - CART_SERVICE_URL=http://cart-service:3003
      - ORDER_SERVICE_URL=http://order-service:3004
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      user-service:
        condition: service_healthy
      product-service:
        condition: service_healthy
      cart-service:
        condition: service_healthy
      order-service:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "bun", "run", "-e", "fetch('http://localhost:3000/health',{method:'POST'}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  user-service:
    build:
      context: .
      dockerfile: services/user-service/Dockerfile
    container_name: ecom-user
    environment:
      - USER_SERVICE_PORT=3001
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ecommerce
      - JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
      - INTERNAL_SECRET=${INTERNAL_SECRET}
      - NODE_ENV=production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "bun", "run", "-e", "fetch('http://localhost:3001/health',{method:'POST'}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  product-service:
    build:
      context: .
      dockerfile: services/product-service/Dockerfile
    container_name: ecom-product
    environment:
      - PRODUCT_SERVICE_PORT=3002
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ecommerce
      - INTERNAL_SECRET=${INTERNAL_SECRET}
      - NODE_ENV=production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "bun", "run", "-e", "fetch('http://localhost:3002/health',{method:'POST'}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  cart-service:
    build:
      context: .
      dockerfile: services/cart-service/Dockerfile
    container_name: ecom-cart
    environment:
      - CART_SERVICE_PORT=3003
      - REDIS_URL=redis://redis:6379
      - PRODUCT_SERVICE_URL=http://product-service:3002
      - INTERNAL_SECRET=${INTERNAL_SECRET}
      - NODE_ENV=production
    depends_on:
      redis:
        condition: service_healthy
      product-service:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "bun", "run", "-e", "fetch('http://localhost:3003/health',{method:'POST'}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  order-service:
    build:
      context: .
      dockerfile: services/order-service/Dockerfile
    container_name: ecom-order
    environment:
      - ORDER_SERVICE_PORT=3004
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ecommerce
      - PRODUCT_SERVICE_URL=http://product-service:3002
      - CART_SERVICE_URL=http://cart-service:3003
      - INTERNAL_SECRET=${INTERNAL_SECRET}
      - NODE_ENV=production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      product-service:
        condition: service_healthy
      cart-service:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "bun", "run", "-e", "fetch('http://localhost:3004/health',{method:'POST'}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  caddy_data:
  caddy_config:
```

### 第五步：创建基础设施配置

**5a. `infra/postgres/postgresql.conf`** — PG 调优
```conf
# 连接
max_connections = 200
superuser_reserved_connections = 3

# 内存（假设 2GB 实例）
shared_buffers = 512MB
effective_cache_size = 1536MB
work_mem = 8MB
maintenance_work_mem = 128MB

# WAL
wal_buffers = 16MB
checkpoint_completion_target = 0.9
max_wal_size = 2GB

# 查询优化
random_page_cost = 1.1          # SSD
effective_io_concurrency = 200   # SSD
default_statistics_target = 100

# 日志
log_min_duration_statement = 200  # 慢查询 200ms
log_statement = 'none'
log_timezone = 'UTC'
timezone = 'UTC'
```

**5b. `infra/postgres/init.sql`** — 初始化 schema
```sql
CREATE SCHEMA IF NOT EXISTS user_service;
CREATE SCHEMA IF NOT EXISTS product_service;
CREATE SCHEMA IF NOT EXISTS order_service;
```

**5c. `infra/redis/redis.conf`** — Redis 调优
```conf
# 内存
maxmemory 256mb
maxmemory-policy allkeys-lru

# 持久化（RDB）
save 900 1
save 300 10
save 60 10000

# 网络
tcp-keepalive 300
timeout 0

# 日志
loglevel notice
```

**5d. `infra/caddy/Caddyfile`**
```caddyfile
{
    # 开发环境用 HTTP，生产环境移除此行启用自动 HTTPS
    auto_https off
}

:80 {
    # 安全 headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        X-XSS-Protection "1; mode=block"
        Referrer-Policy strict-origin-when-cross-origin
        -Server
    }

    # 压缩
    encode gzip zstd

    # 反向代理到 Gateway
    reverse_proxy api-gateway:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}

        # 健康检查
        health_uri /health
        health_method POST
        health_interval 30s
        health_timeout 5s
    }
}

# 生产环境配置（用域名替换）:
# your-domain.com {
#     reverse_proxy api-gateway:3000
#     # Caddy 自动签发 Let's Encrypt 证书
# }
```

### 第六步：创建启动初始化脚本

**`scripts/init.ts`** — 服务启动时执行（缓存预热 + 库存同步 + Lua 注册）

```typescript
// 供每个需要的服务在启动时调用

import { redis, registerLuaScripts, syncStockToRedis, db } from "@repo/database";

export async function initializeService(serviceName: string): Promise<void> {
  console.log(`[INIT] ${serviceName} starting...`);

  // 1. Redis 连接
  await redis.connect();
  console.log("[INIT] Redis connected");

  // 2. 注册 Lua 脚本（product-service / order-service 需要）
  if (["product-service", "order-service"].includes(serviceName)) {
    await registerLuaScripts(redis);
    console.log("[INIT] Lua scripts registered");
  }

  // 3. 库存同步（product-service 启动时）
  if (serviceName === "product-service") {
    const report = await syncStockToRedis(db, redis, { forceSync: true });
    console.log("[INIT] Stock synced: %d SKUs, %d drifted", report.total, report.drifted.length);
  }

  // 4. 缓存预热（product-service 启动时）
  if (serviceName === "product-service") {
    // 预热分类树
    // 预热热门商品
    console.log("[INIT] Cache warmed up");
  }

  console.log(`[INIT] ${serviceName} ready`);
}
```

各服务的 index.ts 在启动时调用：
```typescript
await initializeService("product-service");
```

### 第七步：创建冒烟测试脚本

**`scripts/smoke-test.sh`**
```bash
#!/bin/bash
set -e

BASE_URL="${1:-http://localhost:80}"  # 默认通过 Caddy
PASS=0
FAIL=0

check() {
  local desc="$1"
  local method="$2"
  local url="$3"
  local data="$4"
  local expected_code="$5"
  local extra_headers="$6"

  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL$url" \
    -H "Content-Type: application/json" \
    $extra_headers \
    ${data:+-d "$data"})

  if [ "$status" = "$expected_code" ]; then
    echo "✅ $desc → $status"
    PASS=$((PASS+1))
  else
    echo "❌ $desc → $status (expected $expected_code)"
    FAIL=$((FAIL+1))
  fi
}

echo "══════ 冒烟测试 ══════"
echo "Target: $BASE_URL"
echo ""

# 健康检查
check "Health check" POST "/health" "" "200"

# 公开路由
check "Product list" POST "/api/v1/product/list" '{"page":1}' "200"
check "Category tree" POST "/api/v1/category/tree" '{}' "200"
check "Product search" POST "/api/v1/product/search" '{"keyword":"iPhone"}' "200"

# 认证
REGISTER_RESP=$(curl -s -X POST "$BASE_URL/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"smoke-$(date +%s)@test.com\",\"password\":\"password123\"}")
TOKEN=$(echo "$REGISTER_RESP" | jq -r '.data.accessToken // empty')

if [ -n "$TOKEN" ]; then
  echo "✅ Register → got token"
  PASS=$((PASS+1))

  # 认证路由
  check "User profile" POST "/api/v1/user/profile" "" "200" "-H 'Authorization: Bearer $TOKEN'"
  check "Cart list" POST "/api/v1/cart/list" "" "200" "-H 'Authorization: Bearer $TOKEN'"
  check "Order list" POST "/api/v1/order/list" '{"page":1}' "200" "-H 'Authorization: Bearer $TOKEN'"
else
  echo "❌ Register failed"
  FAIL=$((FAIL+1))
fi

# 未认证应被拒绝
check "Cart without auth" POST "/api/v1/cart/list" "" "401"
check "Order without auth" POST "/api/v1/order/list" '{"page":1}' "401"

# 内部路由应被拦截
check "Internal blocked" POST "/internal/user/detail" '{"id":"x"}' "403"

# 不存在的路由
check "404 route" POST "/api/v1/nonexistent" "" "404"

echo ""
echo "══════ 结果 ══════"
echo "通过: $PASS  失败: $FAIL"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
```

### 第八步：创建压测脚本

**`scripts/stress-test.ts`**
```typescript
// 库存并发安全性压测
// 用法：bun run scripts/stress-test.ts [concurrency] [baseUrl]

const CONCURRENCY = Number(process.argv[2]) || 100;
const BASE_URL = process.argv[3] || "http://localhost:80";

async function main() {
  console.log("═══ 库存并发压测 ═══");
  console.log("并发数:", CONCURRENCY);
  console.log("目标:", BASE_URL);

  // 1. 注册测试用户并获取 tokens
  const tokens: string[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const resp = await fetch(`${BASE_URL}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `stress-${Date.now()}-${i}@test.com`,
        password: "password123",
      }),
    });
    const data = await resp.json();
    tokens.push(data.data.accessToken);
  }
  console.log("注册完成:", tokens.length, "个用户");

  // 2. 获取一个测试 SKU
  const productResp = await fetch(`${BASE_URL}/api/v1/product/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page: 1, pageSize: 1 }),
  });
  const productData = await productResp.json();
  const productId = productData.data.items[0]?.id;

  const skuResp = await fetch(`${BASE_URL}/api/v1/product/sku/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId }),
  });
  const skuData = await skuResp.json();
  const skuId = skuData.data[0]?.id;
  const initialStock = skuData.data[0]?.stock;
  console.log("目标 SKU:", skuId, "初始库存:", initialStock);

  // 3. 获取地址（用第一个用户创建）
  await fetch(`${BASE_URL}/api/v1/user/address/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tokens[0]}`,
    },
    body: JSON.stringify({
      recipient: "压测用户", phone: "13800000000",
      province: "广东", city: "深圳", district: "南山", address: "测试地址",
    }),
  });
  const addrResp = await fetch(`${BASE_URL}/api/v1/user/address/list`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${tokens[0]}` },
  });
  const addrData = await addrResp.json();
  const addressId = addrData.data[0]?.id;

  // 4. 并发下单
  console.log("\n开始并发下单...");
  const start = Date.now();

  const results = await Promise.allSettled(
    tokens.map((token, i) =>
      fetch(`${BASE_URL}/api/v1/order/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "X-Idempotency-Key": `stress-${Date.now()}-${i}`,
        },
        body: JSON.stringify({
          items: [{ skuId, quantity: 1 }],
          addressId,
        }),
      }).then(r => r.json())
    )
  );

  const elapsed = Date.now() - start;

  // 5. 统计结果
  let successCount = 0;
  let failCount = 0;
  let errorDetails: Record<string, number> = {};

  for (const r of results) {
    if (r.status === "fulfilled" && r.value.success) {
      successCount++;
    } else {
      failCount++;
      const code = r.status === "fulfilled" ? r.value.meta?.code || "UNKNOWN" : "NETWORK_ERROR";
      errorDetails[code] = (errorDetails[code] || 0) + 1;
    }
  }

  console.log("\n═══ 压测结果 ═══");
  console.log("耗时:", elapsed, "ms");
  console.log("成功:", successCount);
  console.log("失败:", failCount);
  console.log("失败明细:", errorDetails);
  console.log("预期成功数:", Math.min(CONCURRENCY, initialStock));

  // 6. 验证库存
  const finalSkuResp = await fetch(`${BASE_URL}/api/v1/product/sku/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId }),
  });
  const finalSkuData = await finalSkuResp.json();
  const finalStock = finalSkuData.data.find(s => s.id === skuId);

  console.log("\n═══ 库存验证 ═══");
  console.log("初始库存:", initialStock);
  console.log("成功订单:", successCount);
  console.log("预期剩余:", initialStock - successCount);
  console.log("Redis 实际剩余: 需要手动检查 redis-cli GET stock:" + skuId);

  if (successCount <= initialStock && failCount === CONCURRENCY - successCount) {
    console.log("\n✅ 零超卖验证通过！");
  } else {
    console.log("\n❌ 可能存在超卖！请检查数据");
    process.exit(1);
  }
}

main().catch(console.error);
```

### 第九步：创建部署文档

**`docs/deployment.md`**

内容大纲（让 Claude Code 按此结构生成完整文档）：

```
# 部署指南

## 1. 前置要求
- Docker 24+ / Docker Compose V2
- 域名（可选，Caddy 自动 HTTPS）
- 至少 2GB RAM

## 2. 快速启动
docker compose up -d
docker compose ps
curl -X POST http://localhost/health

## 3. 首次初始化
docker compose exec api-gateway bun run packages/database/src/migrate.ts
docker compose exec api-gateway bun run packages/database/src/seed.ts

## 4. 环境变量说明
（表格列出所有变量 + 默认值 + 说明）

## 5. 生产环境配置
- 修改 Caddyfile 启用 HTTPS
- 修改 .env 中的 JWT secrets
- 修改 PG/Redis 密码
- 调整 postgresql.conf（根据实例规格）

## 6. 运维手册
- 查看日志：docker compose logs -f [service]
- 重启服务：docker compose restart [service]
- 数据库迁移：docker compose exec api-gateway bun run migrate
- 库存对账：docker compose exec product-service bun run stock-sync
- 缓存清理：docker compose exec redis redis-cli FLUSHDB

## 7. 监控（预留）
- /health 端点
- docker compose 健康检查
- 未来集成 Prometheus + Grafana

## 8. 故障排查
- 常见错误及解决方案
```

### 第十步：更新 Makefile

```makefile
.PHONY: dev build test docker-up docker-down migrate seed smoke stress logs

# 本地开发
dev:
	bun run --filter '*' dev

build:
	bun run --filter '*' build

test:
	bun test

# Docker
docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

# 数据库
migrate:
	bun run --filter @repo/database migrate

seed:
	bun run --filter @repo/database seed

# 测试
smoke:
	bash scripts/smoke-test.sh http://localhost:80

stress:
	bun run scripts/stress-test.ts 100 http://localhost:80

# 运维
stock-sync:
	bun run packages/database/src/stock-sync.ts --forceSync

health:
	curl -s -X POST http://localhost/health | jq .
```

### 第十一步：验证

```bash
# 1. 构建并启动全部服务
docker compose up -d --build

# 2. 等待所有服务 healthy
docker compose ps
# 全部应显示 (healthy)

# 3. 初始化数据库
docker compose exec api-gateway bun run packages/database/src/migrate.ts
docker compose exec api-gateway bun run packages/database/src/seed.ts

# 4. 健康检查
curl -s -X POST http://localhost/health | jq .
# 所有检查项 = "ok"

# 5. 冒烟测试
make smoke

# 6. 压测
make stress

# 7. 验证日志
docker compose logs -f --tail=50

# 8. 验证重启恢复
docker compose restart product-service
sleep 10
curl -s -X POST http://localhost/health | jq .
# product-service 恢复 ok + 缓存已预热日志可见

# 9. 验证 Caddy
curl -v http://localhost/api/v1/product/list \
  -H "Content-Type: application/json" -d '{"page":1}'
# 响应 headers 应包含安全 headers（X-Content-Type-Options 等）
```

### 第十二步：输出报告
- 完整文件清单
- `docker compose ps` 输出（全部 healthy）
- 冒烟测试结果（全部通过）
- 压测结果（成功数 + 失败数 + 零超卖确认）
- 各服务镜像大小
- Phase 8 完成确认 ✅
- 项目完整交付总结

## 重要约束
- Dockerfile 使用 bun:1-alpine 基础镜像（最小化体积）
- docker-compose 使用 depends_on + condition: service_healthy 确保启动顺序
- 生产环境不应使用 .env 文件中的默认密码，需要替换
- Caddy 开发环境关闭自动 HTTPS（auto_https off），生产环境开启
- PG max_connections 设为 200，预留 4 服务 × 20 连接 + 余量
- Redis maxmemory-policy 设为 allkeys-lru（购物车和缓存可被淘汰，库存 key 会被重新同步）
- 冒烟测试和压测脚本可在 CI/CD 中复用
- 服务重启后自动执行缓存预热和库存同步（通过 initializeService）
