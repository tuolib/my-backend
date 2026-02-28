# Phase 1 — Step 1: 审计现有代码 + 补齐 Monorepo 骨架

## 前置说明
项目已有约 80% 的 Phase 1 代码。你的任务是：先审计现有代码，再按 architecture.md 的规范补齐差距、修正不一致。

## 执行步骤

### 第一步：读取架构规范
请先阅读以下两个文件，理解完整的架构要求：
- `CLAUDE.md`（项目约定）
- `docs/architecture.md`（仅 Phase 1 章节 + 第1-2章系统全景 + 第7章路由规范）

### 第二步：审计现有代码
扫描当前项目，生成一份差距报告。对照 architecture.md Phase 1 的产出物清单，逐项检查：

1. **根 package.json** — 是否是 bun workspace 配置？workspace 范围是否包含 `apps/*`, `services/*`, `packages/*`？
2. **tsconfig 继承链** — 根 tsconfig.json 是否存在？各包是否有自己的 tsconfig.json 并 extends 根配置？
3. **packages/shared** — 骨架是否存在？package.json 中 name 是否为 `@repo/shared`？
4. **packages/database** — 骨架是否存在？package.json 中 name 是否为 `@repo/database`？
5. **apps/api-gateway** — 骨架是否存在？package.json 中 name 和端口配置？
6. **services/** — 是否存在以下 4 个服务目录（注意：新架构需要 4 个，不是 2 个）：
   - `services/user-service` (:3001)
   - `services/product-service` (:3002)
   - `services/cart-service` (:3003) ← 新增
   - `services/order-service` (:3004) ← 新增
7. **docker-compose.yml** — 是否包含 PostgreSQL 16 + Redis 7？健康检查配置？
8. **Caddyfile** — 是否存在？反向代理规则？
9. **.env.example** — 是否包含所有服务端口、DB/Redis 连接、JWT 密钥占位、INTERNAL_SECRET？
10. **Makefile** — 是否存在？包含 dev/build/test/docker-up/docker-down/migrate 命令？

### 第三步：执行补齐与修正
根据审计结果，执行以下操作（仅修改需要修改的部分，已正确的保持不动）：

**3a. workspace 配置**
确保根 package.json 的 workspaces 包含：
```json
{
  "workspaces": ["apps/*", "services/*", "packages/*"]
}
```

**3b. 新增缺失的服务骨架**
如果 `services/cart-service` 和 `services/order-service` 不存在，创建它们：
- `services/cart-service/package.json` (name: `@repo/cart-service`)
- `services/cart-service/tsconfig.json`
- `services/cart-service/src/index.ts`（空 Hono app，监听 :3003）
- `services/order-service/package.json` (name: `@repo/order-service`)
- `services/order-service/tsconfig.json`
- `services/order-service/src/index.ts`（空 Hono app，监听 :3004）

**3c. 统一所有空服务入口**
每个 service 和 app 的空入口 `src/index.ts` 应该是一个最小的 Hono app：
```typescript
import { Hono } from "hono";

const app = new Hono();

app.post("/health", (c) => c.json({ status: "ok", service: "xxx-service" }));

export default {
  port: 300x,
  fetch: app.fetch,
};
```

**3d. 确保 packages 的 package.json 正确**
- `packages/shared/package.json` → name: `@repo/shared`，main/types 指向 `src/index.ts`
- `packages/database/package.json` → name: `@repo/database`，main/types 指向 `src/index.ts`

**3e. .env.example 完善**
确保包含以下所有配置项（已有的保留，缺失的补充）：
```env
# ── 服务端口 ──
API_GATEWAY_PORT=3000
USER_SERVICE_PORT=3001
PRODUCT_SERVICE_PORT=3002
CART_SERVICE_PORT=3003
ORDER_SERVICE_PORT=3004

# ── PostgreSQL ──
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ecommerce
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=postgres
PG_DATABASE=ecommerce

# ── Redis ──
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# ── JWT ──
JWT_ACCESS_SECRET=your-access-secret-change-in-production
JWT_REFRESH_SECRET=your-refresh-secret-change-in-production
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ── 服务间通信 ──
INTERNAL_SECRET=your-internal-secret-change-in-production

# ── 环境 ──
NODE_ENV=development
LOG_LEVEL=debug
```

**3f. docker-compose.yml 完善**
确保包含 PostgreSQL 16 + Redis 7，且有健康检查：
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ecommerce
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```
如果已有 Caddy 配置就保留，没有就暂时不加（Phase 8 部署阶段再完善）。

**3g. Makefile**
确保存在且包含关键命令（已有的保留，缺失的补充）：
```makefile
.PHONY: dev build test docker-up docker-down migrate

dev:
	bun run --filter '*' dev

build:
	bun run --filter '*' build

test:
	bun test

docker-up:
	docker compose up -d

docker-down:
	docker compose down

migrate:
	bun run --filter @repo/database migrate
```

**3h. 统一响应格式**
如果 packages/shared 中已有响应格式相关代码，检查是否符合以下格式，如不符合则标记需要在 Phase 2 修改（Phase 1 不改业务代码，只标记）：
```typescript
// 成功
{ code: 200, success: true, data: T, message: "", traceId: string }
// 失败
{ code: number, success: false, message: string, data: null, meta: { code: string, message: string, details?: unknown }, traceId: string }
```

### 第四步：验证
执行以下验证命令，确保全部通过：
```bash
bun install
docker compose up -d
docker compose ps  # 确认 postgres 和 redis 都是 healthy
# 等待 healthy 后
docker compose down
```

### 第五步：输出报告
完成后，输出一份简短的执行报告：
- 已存在且无需修改的项
- 新增的文件/目录列表
- 修改的文件列表及修改内容摘要
- Phase 2 需要关注的遗留项（如响应格式不一致等）
- 验证结果

## 重要约束
- 不写任何业务代码（中间件、路由逻辑、DB schema 等都是后续阶段的事）
- 不安装业务依赖（Drizzle、ioredis 等留给后续阶段）
- 只安装骨架必需的依赖（hono、typescript）
- 保留现有代码中已正确的部分，只补齐和修正
