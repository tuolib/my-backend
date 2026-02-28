# Phase 5 — Step 2: services/product-service 库存内部接口 + 并发测试

## 前置条件
Phase 5 Step 1 已完成。请先确认：
- 商品列表/详情/搜索/分类树/Admin CRUD 全部测试通过
- /internal/product/sku/batch 可正常批量查询 SKU
- Redis 中有种子数据的库存 key（`stock:{skuId}` = 100）
- Docker 中 PostgreSQL 和 Redis 运行中

## 本次任务
实现 product-service 的全部库存内部接口：reserve（预扣）、release（释放）、confirm（确认）、sync（同步）、adjust（管理员调整）。
编写并发压测，验证零超卖。完成后 Phase 5 整体交付。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `docs/architecture.md` 第 8 章全部（库存扣减流程 8.1 + Lua 脚本 8.2 + 同步机制 8.3）
- `docs/architecture.md` 第 4 章（Redis Key：`stock:{skuId}`）
- `docs/architecture.md` 第 3.5 节（stock_operations 表结构）

### 第二步：实现 Repository 层补充

**`repositories/stock.repo.ts`**
```typescript
import { db } from "@repo/database";
import { skus, stockOperations } from "@repo/database";

// ── SKU 库存（DB 层）──

getSkuStock(skuId: string): Promise<{ stock: number; version: number } | null>
  // SELECT stock, version FROM skus WHERE id = :skuId

confirmDeduct(skuId: string, quantity: number, currentVersion: number): Promise<boolean>
  // UPDATE skus
  //   SET stock = stock - :quantity, version = version + 1, updated_at = now()
  //   WHERE id = :skuId AND version = :currentVersion AND stock >= :quantity
  // 返回 affected rows > 0（乐观锁成功）

confirmRelease(skuId: string, quantity: number): Promise<void>
  // UPDATE skus SET stock = stock + :quantity, version = version + 1, updated_at = now()
  // WHERE id = :skuId

adjustStock(skuId: string, newStock: number): Promise<void>
  // UPDATE skus SET stock = :newStock, version = version + 1, updated_at = now()
  // WHERE id = :skuId
  // 管理员直接设置库存值

getAllActiveSkuStocks(): Promise<Array<{ id: string; stock: number }>>
  // SELECT id, stock FROM skus WHERE status = 'active'
  // 用于 Redis ↔ DB 同步

// ── 库存操作日志 ──

logOperation(data: {
  skuId: string; orderId?: string;
  type: "reserve" | "confirm" | "release" | "adjust";
  quantity: number;
}): Promise<void>
  // INSERT INTO stock_operations
```

### 第三步：实现 Stock Service

**`services/stock.service.ts`**

这是整个系统并发安全的核心，每个方法都要仔细实现。

```typescript
import { redis, deductStock, deductStockMulti, releaseStock, releaseStockMulti, getStock, setStock, syncStockToRedis } from "@repo/database";

// ═══════════════════════════════════════════════
// reserve — 库存预扣（下单时调用）
// ═══════════════════════════════════════════════

async function reserveSingle(
  skuId: string, quantity: number, orderId: string
): Promise<void>
  // 1. 调用 Redis Lua: deductStock(redis, skuId, quantity)
  // 2. 失败（code=0）→ 抛 ValidationError(STOCK_INSUFFICIENT)
  // 3. 失败（code=-1）→ 抛 InternalError("Stock key not found, run sync")
  // 4. 成功 → 记录 stock_operation (type=reserve, orderId)
  // 5. 日志：[STOCK RESERVE] skuId={} qty={} orderId={}

async function reserveMulti(
  items: Array<{ skuId: string; quantity: number }>, orderId: string
): Promise<void>
  // 1. 调用 Redis Lua: deductStockMulti(redis, items)
  // 2. 失败 → 返回第几个 SKU 不足，抛 ValidationError(STOCK_INSUFFICIENT)
  //    错误详情包含：{ failedSkuId, failedIndex, available }
  //    available 通过 getStock(failedSkuId) 获取当前库存
  // 3. 成功 → 批量记录 stock_operations (type=reserve)
  // 4. 日志：[STOCK RESERVE MULTI] orderId={} items={}

// ═══════════════════════════════════════════════
// release — 库存释放（订单取消/超时）
// ═══════════════════════════════════════════════

async function releaseSingle(
  skuId: string, quantity: number, orderId: string
): Promise<void>
  // 1. 调用 Redis Lua: releaseStock(redis, skuId, quantity)
  // 2. 记录 stock_operation (type=release, orderId)
  // 3. 日志：[STOCK RELEASE] skuId={} qty={} orderId={}

async function releaseMulti(
  items: Array<{ skuId: string; quantity: number }>, orderId: string
): Promise<void>
  // 1. 调用 Redis Lua: releaseStockMulti(redis, items)
  // 2. 批量记录 stock_operations (type=release)

// ═══════════════════════════════════════════════
// confirm — 库存确认（支付成功后，DB 最终一致）
// ═══════════════════════════════════════════════

async function confirmSingle(
  skuId: string, quantity: number, orderId: string
): Promise<void>
  // 1. 获取当前 SKU 的 version: stockRepo.getSkuStock(skuId)
  // 2. 乐观锁更新: stockRepo.confirmDeduct(skuId, quantity, version)
  // 3. 失败（version 冲突）→ 重试最多 3 次
  // 4. 3 次后仍失败 → 抛 InternalError + 告警日志
  // 5. 成功 → 记录 stock_operation (type=confirm)
  // 6. 日志：[STOCK CONFIRM] skuId={} qty={} orderId={} version={}→{}

async function confirmMulti(
  items: Array<{ skuId: string; quantity: number }>, orderId: string
): Promise<void>
  // 在一个 PG 事务内对每个 SKU 执行 confirmSingle 逻辑
  // 任一失败则整个事务回滚
  // 使用 db.transaction(async (tx) => { ... })

// ═══════════════════════════════════════════════
// sync — Redis ↔ DB 库存同步
// ═══════════════════════════════════════════════

async function syncAll(options?: { forceSync?: boolean }): Promise<SyncReport>
  // 调用 @repo/database 的 syncStockToRedis()
  // forceSync=true：以 DB 为准覆盖 Redis
  // 默认 dryRun：只输出差异报告

// ═══════════════════════════════════════════════
// adjust — 管理员手动调整库存
// ═══════════════════════════════════════════════

async function adjust(
  skuId: string, newStock: number, reason?: string
): Promise<void>
  // 1. DB: stockRepo.adjustStock(skuId, newStock)
  // 2. Redis: setStock(redis, skuId, newStock)
  // 3. 记录 stock_operation (type=adjust, quantity=newStock)
  // 4. 清除该 SKU 所属商品的详情缓存
  // 日志：[STOCK ADJUST] skuId={} newStock={} reason={}
```

### 第四步：实现 Zod Schema

**`schemas/stock.schema.ts`**
```typescript
reserveSchema = z.object({
  items: z.array(z.object({
    skuId: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1),
  orderId: z.string().min(1),
});

releaseSchema = z.object({
  items: z.array(z.object({
    skuId: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1),
  orderId: z.string().min(1),
});

confirmSchema = z.object({
  items: z.array(z.object({
    skuId: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1),
  orderId: z.string().min(1),
});

syncSchema = z.object({
  forceSync: z.boolean().optional().default(false),
});

adjustSchema = z.object({
  skuId: z.string().min(1),
  quantity: z.number().int().min(0),   // 新库存值
  reason: z.string().optional(),
});
```

### 第五步：完善内部路由

**更新 `routes/internal.ts`**

在 Step 1 已有的 /internal/product/sku/batch 基础上，新增全部库存路由：

```typescript
// POST /internal/stock/reserve — 库存预扣
//   Body: { items: [{ skuId, quantity }], orderId }
//   成功：{ success: true, data: null }
//   失败：422 STOCK_INSUFFICIENT + details: { failedSkuId, available }

// POST /internal/stock/release — 库存释放
//   Body: { items: [{ skuId, quantity }], orderId }

// POST /internal/stock/confirm — 库存确认（DB 乐观锁）
//   Body: { items: [{ skuId, quantity }], orderId }

// POST /internal/stock/sync — Redis ↔ DB 同步
//   Body: { forceSync?: boolean }
//   返回 SyncReport

// POST /api/v1/admin/stock/adjust — 管理员调整（挂 authMiddleware）
//   Body: { skuId, quantity, reason? }
```

### 第六步：注册 Lua 脚本

更新 `src/index.ts`，在服务启动时注册 Lua 脚本：

```typescript
import { redis, registerLuaScripts } from "@repo/database";

// 启动时初始化
await redis.connect();
await registerLuaScripts(redis);
console.log("[INIT] Lua scripts registered");

// ... app 挂载 ...

export default {
  port: Number(process.env.PRODUCT_SERVICE_PORT) || 3002,
  fetch: app.fetch,
};
```

### 第七步：编写测试

**`src/__tests__/stock.test.ts` — 基础功能测试**
```
前置：每个测试前 SET stock:{testSkuId} 100

1. reserve 单个 SKU（扣 10）→ Redis 库存变 90 + stock_operation 有记录
2. reserve 库存不足 → 422 STOCK_INSUFFICIENT + 库存不变
3. reserveMulti 3 个 SKU → 全部扣减成功
4. reserveMulti 第 2 个不足 → 全部不扣（原子性验证）+ 返回 failedIndex
5. release 单个 SKU（还 10）→ 库存恢复 100
6. releaseMulti → 批量恢复
7. confirm → DB 的 skus.stock 正确扣减 + version 递增
8. confirm 乐观锁冲突 → 重试成功（先手动改 version 模拟冲突）
9. adjust → DB + Redis 同时更新
10. sync（dryRun）→ 返回报告，不修改数据
```

**`src/__tests__/stock-concurrent.test.ts` — 并发安全测试 ⚡️**
```
这是最重要的测试，验证零超卖。

测试场景 1：单 SKU 并发扣减
  - 初始库存 100
  - 并发发起 200 个请求，每个扣 1
  - 预期：100 个成功 + 100 个 STOCK_INSUFFICIENT
  - 验证：Redis 库存 = 0（不是负数）

测试场景 2：多 SKU 原子性
  - SKU-A 库存 10，SKU-B 库存 5
  - 订单需要 SKU-A x 3 + SKU-B x 3
  - 并发发起 5 个这样的订单
  - 预期：最多 1 个成功（因为 SKU-B 只够 1 单的 3 个）
  - 验证：失败的订单没有扣减任何 SKU 的库存（原子性）

测试场景 3：reserve → release 循环
  - 初始库存 100
  - 并发：50 个 reserve(2) + 50 个 release(2)
  - 最终库存应该仍然是 100

实现方式：
  使用 Promise.allSettled 并发发起请求
  使用 Bun 的 fetch 直接调内部接口
```

### 第八步：验证
```bash
docker compose up -d

cd services/product-service

# 基础测试
bun test src/__tests__/stock.test.ts

# 并发测试（单独跑，耗时较长）
bun test src/__tests__/stock-concurrent.test.ts

# 全部测试
bun test

# 手动验证库存操作
bun run src/index.ts &
sleep 1

# 查看某个 SKU 当前库存
SKUID=$(docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -t -c \
  "SELECT id FROM product_service.skus LIMIT 1;" | tr -d ' \n')

echo "SKU: $SKUID"

# reserve
curl -s -X POST http://localhost:3002/internal/stock/reserve \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"skuId\":\"$SKUID\",\"quantity\":5}],\"orderId\":\"test-order-1\"}" | jq .

# 检查 Redis 库存
docker exec -it $(docker ps -q -f name=redis) redis-cli GET "stock:$SKUID"

# release
curl -s -X POST http://localhost:3002/internal/stock/release \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"skuId\":\"$SKUID\",\"quantity\":5}],\"orderId\":\"test-order-1\"}" | jq .

# 检查操作日志
docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -c \
  "SELECT type, quantity, order_id, created_at FROM order_service.stock_operations ORDER BY created_at DESC LIMIT 10;"

kill %1
```

### 第九步：输出报告
- 文件清单
- 全部测试结果（重点：并发测试的成功/失败分布）
- 并发测试场景 1 的数据：200 请求 → X 成功 + Y 失败 + 最终库存
- Phase 5 完成确认 ✅
- Phase 6 预告：cart-service + order-service

## 重要约束
- reserve/release 操作 Redis（速度优先），confirm 操作 DB（一致性优先）
- 乐观锁 confirm 最多重试 3 次，仍失败则抛错 + 告警日志（不能无限重试）
- confirmMulti 必须在 PG 事务内完成，任一 SKU 失败则全部回滚
- 所有库存操作必须记录 stock_operations 日志（type + quantity + orderId）
- adjust 走 DB 优先：先写 DB 再写 Redis（管理员操作频率低，DB 为准）
- 并发测试中 Redis 库存绝不能出现负数
- stock_operations 表在 order_service schema 下（因为与订单强关联）
