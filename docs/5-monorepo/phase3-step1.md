# Phase 3 — Step 1: packages/database 连接层 + 全部 Drizzle Schema + 迁移

## 前置条件
Phase 2 已完成。请先确认：
- `packages/shared` 全部测试通过
- `import { getConfig, generateId } from "@repo/shared"` 正常工作
- Docker 中 PostgreSQL 和 Redis 正在运行（`docker compose up -d`）

## 本次任务
实现 packages/database 的核心：PG 连接池、Redis 封装、全部 3 个域的 Drizzle schema 定义、迁移系统。
Lua 脚本和种子数据留给下一步。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `CLAUDE.md`（数据库规范 + 命名约定）
- `docs/architecture.md` 第 3 章全部（3.1 schema 隔离 ~ 3.6 索引策略）

### 第二步：审计现有代码
扫描 `packages/database/src/` 下已有文件，列出现状。
如果已有 schema 定义，对照 architecture.md 检查：
- 表名、字段名、字段类型是否匹配
- 是否使用了 PG schema 隔离（user_service / product_service / order_service）
- 是否缺少新增的表（orders, order_items, order_addresses, payment_records, stock_operations）

### 第三步：安装依赖
```bash
cd packages/database
bun add drizzle-orm postgres ioredis
bun add -d drizzle-kit typescript @types/bun
```
说明：
- `postgres`：PostgreSQL 客户端（postgres.js），Drizzle 推荐的轻量驱动
- `drizzle-kit`：迁移生成与执行工具
- `ioredis`：Redis 客户端

确保 package.json 中有以下 scripts：
```json
{
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "bun run src/migrate.ts",
    "seed": "bun run src/seed.ts",
    "studio": "drizzle-kit studio"
  }
}
```

### 第四步：实现连接层

**4a. `src/client.ts` — PostgreSQL 连接池**
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "@repo/shared";

const config = getConfig();

// 连接池配置
const connection = postgres(config.DATABASE_URL, {
  max: 20,                     // 最大连接数（单 service）
  idle_timeout: 30,            // 空闲超时（秒）
  connect_timeout: 5,          // 连接超时（秒）
});

export const db = drizzle(connection);
export { connection };         // 导出原始连接，用于 graceful shutdown
```

**4b. `src/redis.ts` — Redis 连接封装**
```typescript
import Redis from "ioredis";
import { getConfig } from "@repo/shared";

const config = getConfig();

export function createRedis(): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null;  // 停止重试
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,            // 延迟连接，手动调用 connect()
  });
}

// 默认实例（大多数场景直接用这个）
export const redis = createRedis();
```

**4c. `src/drizzle.config.ts` — Drizzle Kit 配置**
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/*.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/ecommerce",
  },
});
```

### 第五步：实现全部 Schema

所有表严格按照 `docs/architecture.md` 第 3.3-3.5 节定义。
关键约定：
- 每个域使用 PG schema 隔离（通过 `pgSchema()` 或 Drizzle 的 schema 配置）
- 所有 id 字段：`varchar(21).primaryKey()`（nanoid）
- 所有时间字段：`timestamp({ withTimezone: true, mode: "date" })`
- JSONB 字段：`jsonb()`
- DECIMAL 字段：`decimal({ precision: 12, scale: 2 })`
- 乐观锁字段：`integer("version").default(0).notNull()`

**5a. `src/schema/users.ts` — User Service 域**

定义 PG schema: `user_service`

表：
- `users` — 完整字段参见 architecture.md 3.3
- `userAddresses` — 收货地址
- `refreshTokens` — refresh token 存储

每个表导出：表定义 + Drizzle 推断的 Insert/Select 类型：
```typescript
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

关系定义（Drizzle relations）：
- users → userAddresses (one-to-many)
- users → refreshTokens (one-to-many)

**5b. `src/schema/products.ts` — Product Service 域**

定义 PG schema: `product_service`

表：
- `categories` — 多级分类（parent_id 自引用）
- `products` — 商品主表（含 min_price, max_price, total_sales 冗余字段）
- `productCategories` — 商品-分类多对多关联
- `productImages` — 商品图片
- `skus` — SKU（含 version 乐观锁字段、low_stock 预警阈值）

关系定义：
- products → skus (one-to-many)
- products → productImages (one-to-many)
- products ↔ categories (many-to-many through productCategories)
- categories → categories (self-referencing, parent)

**5c. `src/schema/orders.ts` — Order Service 域**

定义 PG schema: `order_service`

表：
- `orders` — 订单主表（含状态机字段、幂等键、过期时间、version 乐观锁）
- `orderItems` — 订单商品快照（product_title, sku_attrs, image_url, unit_price 都是快照）
- `orderAddresses` — 订单地址快照（独立表，不 FK 到 user_addresses）
- `paymentRecords` — 支付记录（含 raw_notify JSONB 审计字段）
- `stockOperations` — 库存操作日志（type: reserve/confirm/release/adjust）

关系定义：
- orders → orderItems (one-to-many)
- orders → orderAddresses (one-to-one)
- orders → paymentRecords (one-to-many)

**5d. `src/schema/index.ts` — 统一导出**
```typescript
export * from "./users";
export * from "./products";
export * from "./orders";
```

### 第六步：创建自定义索引迁移

Drizzle Kit 生成的迁移可能不包含所有自定义索引。
在迁移生成后，检查是否包含 architecture.md 3.6 节的全部索引。
缺失的索引手动创建一个额外迁移文件 `add-custom-indexes.sql`：

关键索引（确保包含）：
```sql
-- 全文搜索索引
CREATE INDEX IF NOT EXISTS idx_products_fulltext ON product_service.products
  USING GIN(to_tsvector('simple', title || ' ' || coalesce(description, '') || ' ' || coalesce(brand, '')));

-- JSONB 索引
CREATE INDEX IF NOT EXISTS idx_products_attrs ON product_service.products USING GIN(attributes);

-- 条件索引（部分索引）
CREATE INDEX IF NOT EXISTS idx_products_sales ON product_service.products(total_sales DESC)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_skus_stock_low ON product_service.skus(product_id)
  WHERE stock <= low_stock AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_orders_expires ON order_service.orders(expires_at)
  WHERE status = 'pending';
```

### 第七步：实现迁移入口

**`src/migrate.ts`**
```typescript
// 1. 创建 3 个 PG schema（如果不存在）
// 2. 执行 Drizzle 迁移
// 3. 执行自定义索引迁移（如果有）
// 用法：bun run src/migrate.ts
```

要确保迁移脚本先创建 PG schema 再建表：
```sql
CREATE SCHEMA IF NOT EXISTS user_service;
CREATE SCHEMA IF NOT EXISTS product_service;
CREATE SCHEMA IF NOT EXISTS order_service;
```

### 第八步：更新 `src/index.ts` 统一导出
```typescript
export { db, connection } from "./client";
export { redis, createRedis } from "./redis";
export * from "./schema";
// Lua 脚本和 seed 在下一步添加
```

### 第九步：验证
```bash
# 确保 PG 和 Redis 运行中
docker compose up -d

cd packages/database

# 生成迁移
bun run generate

# 执行迁移
bun run migrate

# 验证 — 连接 PG 检查
docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -c "\dn"
# 应该看到 user_service, product_service, order_service 三个 schema

docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -c "\dt user_service.*"
# 应该看到 users, user_addresses, refresh_tokens

docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -c "\dt product_service.*"
# 应该看到 categories, products, product_categories, product_images, skus

docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -c "\dt order_service.*"
# 应该看到 orders, order_items, order_addresses, payment_records, stock_operations

# 验证索引
docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -c "\di product_service.*"

# 验证类型安全（临时脚本）
echo '
import { db } from "./src/client";
import { users, products, orders, skus } from "./src/schema";
// 如果以下行有类型错误，说明 schema 定义有问题
type UserCheck = typeof users.$inferSelect;
type SkuCheck = typeof skus.$inferSelect;
type OrderCheck = typeof orders.$inferSelect;
console.log("Schema types OK");
process.exit(0);
' > /tmp/check-schema.ts
bun run /tmp/check-schema.ts
rm /tmp/check-schema.ts

cd ../..
bun install
```

### 第十步：输出报告
- 新增/修改的文件清单
- 迁移执行结果（表和索引列表）
- 类型验证结果
- 下一步预告（Phase 3 Step 2）：Lua 脚本 + 种子数据 + Redis 库存初始化

## 重要约束
- 严格按照 architecture.md 3.3-3.5 的表结构，不增不减字段（除非发现设计缺陷需要讨论）
- 所有表名和字段名使用 snake_case
- 使用 PG schema 隔离（user_service / product_service / order_service），不是独立数据库
- Drizzle 的 `pgSchema()` API 来定义 schema 隔离
- DECIMAL 类型用于所有金额字段，不用 FLOAT
- 不在本步实现 Lua 脚本和种子数据
- 不在本步编写业务代码
