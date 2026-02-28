# Phase 3 — Step 2: Lua 脚本 + 种子数据 + Redis 库存初始化

## 前置条件
Phase 3 Step 1 已完成。请先确认：
- `bun run migrate` 执行成功，15 张表全部创建
- 3 个 PG schema（user_service, product_service, order_service）存在
- `import { db, redis } from "@repo/database"` 正常工作
- Docker 中 PostgreSQL 和 Redis 正在运行

## 本次任务
实现 Redis Lua 库存脚本（原子扣减/释放/同步）、开发种子数据、Redis 库存初始化。完成后 packages/database 整包交付。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `docs/architecture.md` 第 8 章（库存并发控制）— 特别是 8.2 Lua 脚本 + 8.3 库存同步机制
- `docs/architecture.md` 第 4 章（Redis Key 命名约定）

### 第二步：审计现有代码
检查 `packages/database/src/` 下是否已有 lua/、seed.ts 等文件。

### 第三步：实现 Lua 脚本

创建目录 `packages/database/src/lua/`，放置以下脚本文件：

**3a. `src/lua/stock-deduct.lua` — 单 SKU 库存扣减**
```lua
-- KEYS[1] = stock:{skuId}
-- ARGV[1] = quantity (要扣减的数量)
-- 返回: 1=成功, 0=库存不足, -1=key不存在

local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then return -1 end
if stock < tonumber(ARGV[1]) then return 0 end
redis.call('DECRBY', KEYS[1], ARGV[1])
return 1
```

**3b. `src/lua/stock-deduct-multi.lua` — 多 SKU 原子扣减（一个订单多个商品）**
```lua
-- KEYS = [stock:sku1, stock:sku2, ...]
-- ARGV = [qty1, qty2, ...]
-- 返回: 0=全部成功, >0=第 N 个 SKU 库存不足（从1开始）

-- 第一阶段：检查所有库存是否充足
for i = 1, #KEYS do
  local stock = tonumber(redis.call('GET', KEYS[i]))
  if stock == nil then return i end
  if stock < tonumber(ARGV[i]) then return i end
end

-- 第二阶段：全部充足，执行扣减
for i = 1, #KEYS do
  redis.call('DECRBY', KEYS[i], ARGV[i])
end

return 0
```

**3c. `src/lua/stock-release.lua` — 库存释放（订单取消/超时）**
```lua
-- KEYS[1] = stock:{skuId}
-- ARGV[1] = quantity (要释放的数量)
-- 返回: 释放后的库存值, -1=key不存在

local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then return -1 end
return redis.call('INCRBY', KEYS[1], ARGV[1])
```

**3d. `src/lua/stock-release-multi.lua` — 多 SKU 批量释放**
```lua
-- KEYS = [stock:sku1, stock:sku2, ...]
-- ARGV = [qty1, qty2, ...]
-- 返回: 0=成功

for i = 1, #KEYS do
  local stock = tonumber(redis.call('GET', KEYS[i]))
  if stock ~= nil then
    redis.call('INCRBY', KEYS[i], ARGV[i])
  end
end

return 0
```

### 第四步：实现 Lua 脚本加载器

**`src/lua/index.ts` — 脚本加载与调用封装**
```typescript
import { readFileSync } from "fs";
import { join } from "path";
import type Redis from "ioredis";

// 读取所有 .lua 文件内容
const SCRIPTS = {
  stockDeduct: readFileSync(join(__dirname, "stock-deduct.lua"), "utf-8"),
  stockDeductMulti: readFileSync(join(__dirname, "stock-deduct-multi.lua"), "utf-8"),
  stockRelease: readFileSync(join(__dirname, "stock-release.lua"), "utf-8"),
  stockReleaseMulti: readFileSync(join(__dirname, "stock-release-multi.lua"), "utf-8"),
} as const;

// 脚本注册（服务启动时调用一次）
// 使用 ioredis 的 defineCommand 或手动 SCRIPT LOAD + EVALSHA
export async function registerLuaScripts(redis: Redis): Promise<void>

// 封装调用接口
export async function deductStock(
  redis: Redis, skuId: string, quantity: number
): Promise<{ success: boolean; code: number }>
  // 调用 stock-deduct.lua
  // 返回 { success: true/false, code: 1/0/-1 }

export async function deductStockMulti(
  redis: Redis, items: Array<{ skuId: string; quantity: number }>
): Promise<{ success: boolean; failedIndex?: number }>
  // 调用 stock-deduct-multi.lua
  // 成功：{ success: true }
  // 失败：{ success: false, failedIndex: N }（第 N 个 SKU 库存不足）

export async function releaseStock(
  redis: Redis, skuId: string, quantity: number
): Promise<{ success: boolean; newStock: number }>
  // 调用 stock-release.lua

export async function releaseStockMulti(
  redis: Redis, items: Array<{ skuId: string; quantity: number }>
): Promise<{ success: boolean }>
  // 调用 stock-release-multi.lua

// 库存查询（不需要 Lua，直接 GET）
export async function getStock(redis: Redis, skuId: string): Promise<number>
  // GET stock:{skuId} → parse int → 返回

// 库存设置（管理端 / 初始化用）
export async function setStock(redis: Redis, skuId: string, quantity: number): Promise<void>
  // SET stock:{skuId} {quantity}
```

### 第五步：实现种子数据

**`src/seed.ts` — 开发环境种子数据**

种子数据包含完整的可测试数据集：

```
用户（3个）：
  - admin@test.com / password123（管理员，未来用）
  - alice@test.com / password123（普通用户）
  - bob@test.com   / password123（普通用户）
  密码全部使用 @repo/shared 的 hashPassword() 哈希

用户地址（2个，属于 alice）：
  - 家庭地址（is_default: true）
  - 公司地址

分类（3个顶级 + 子分类）：
  - 电子产品
    - 手机
    - 电脑
  - 服装
    - 男装
    - 女装
  - 食品

商品（6个，分布在不同分类）：
  - iPhone 15 Pro（手机，2个SKU：128GB/256GB）
  - MacBook Pro 14（电脑，2个SKU：M3/M3 Pro）
  - 运动T恤（男装，3个SKU：S/M/L）
  - 连衣裙（女装，2个SKU：S/M）
  - 有机坚果（食品，1个SKU）
  - 精品咖啡豆（食品，2个SKU：200g/500g）

每个商品配：
  - 1-2 张商品图片（URL 用占位符 https://placehold.co/800x800）
  - 商品-分类关联
  - products.min_price / max_price 根据 SKU 价格计算

SKU 库存：每个 SKU 初始库存 100
```

种子数据执行流程：
```typescript
// 1. 清空所有表（按外键依赖顺序）
// 2. 插入用户 + 地址
// 3. 插入分类
// 4. 插入商品 + 图片 + 分类关联 + SKU
// 5. 初始化 Redis 库存：对每个 SKU 执行 SET stock:{skuId} 100
// 6. 打印统计：X 个用户, Y 个商品, Z 个 SKU, Redis 库存已初始化
```

### 第六步：实现库存同步工具

**`src/stock-sync.ts` — Redis ↔ DB 库存对账**
```typescript
// 用于定时任务（Phase 8）和手动运维
// 功能：
// 1. 从 DB 查询所有 active SKU 及其 stock 值
// 2. 从 Redis 查询对应的 stock:{skuId} 值
// 3. 对比差异，输出报告
// 4. 可选：以 DB 为准覆盖 Redis（forceSync 参数）

export async function syncStockToRedis(
  db: Database, redis: Redis, options?: { forceSync?: boolean; dryRun?: boolean }
): Promise<SyncReport>

type SyncReport = {
  total: number;
  synced: number;
  drifted: Array<{ skuId: string; dbStock: number; redisStock: number }>;
  missing: string[];  // 在 DB 有但 Redis 没有的 SKU
}
```

### 第七步：更新 `src/index.ts` 统一导出
```typescript
// 连接
export { db, connection } from "./client";
export { redis, createRedis } from "./redis";

// Schema + 类型
export * from "./schema";

// Lua 脚本
export {
  registerLuaScripts,
  deductStock, deductStockMulti,
  releaseStock, releaseStockMulti,
  getStock, setStock,
} from "./lua";

// 库存同步
export { syncStockToRedis } from "./stock-sync";
```

### 第八步：编写测试

**`src/lua/index.test.ts` — Lua 脚本测试（需要真实 Redis）**
```
前置：docker compose up -d（确保 Redis 运行）

测试用例：
- deductStock：初始 100，扣减 10 → 成功，剩余 90
- deductStock：库存 5，扣减 10 → 失败（库存不足），库存仍为 5
- deductStock：key 不存在 → 返回 -1
- deductStockMulti：3 个 SKU 全部充足 → 全部扣减成功
- deductStockMulti：第 2 个 SKU 不足 → 全部不扣减（原子性），返回 failedIndex=2
- releaseStock：库存 90，释放 10 → 库存变为 100
- releaseStockMulti：批量释放 → 全部恢复
- getStock / setStock：基本读写

每个测试前：用 SET 初始化测试用的 stock key
每个测试后：用 DEL 清理测试 key
```

### 第九步：验证
```bash
# 确保 Docker 运行
docker compose up -d

cd packages/database

# 运行测试
bun test

# 执行种子数据
bun run seed
# 应该看到统计输出

# 验证 DB 数据
docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -c \
  "SELECT id, email, nickname FROM user_service.users;"

docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -c \
  "SELECT p.title, s.sku_code, s.price, s.stock FROM product_service.products p JOIN product_service.skus s ON p.id = s.product_id;"

# 验证 Redis 库存
docker exec -it $(docker ps -q -f name=redis) redis-cli KEYS "stock:*"
docker exec -it $(docker ps -q -f name=redis) redis-cli GET "stock:<任意skuId>"
# 应该返回 100

# 全量验证
cd ../..
bun install
bun test  # 全项目测试
```

### 第十步：输出报告
- 新增/修改的文件清单
- packages/database 完整文件树
- 种子数据统计
- Lua 脚本测试结果
- Redis 库存 key 列表
- Phase 3 完成确认 ✅
- Phase 4 预告：services/user-service（注册/登录/JWT/地址管理）

## 重要约束
- Lua 脚本必须保证原子性：deductStockMulti 要么全部扣减，要么全部不扣（两阶段检查）
- Redis key 格式严格遵循：`stock:{skuId}`（无前缀 service 名，因为库存是跨服务共享的）
- 种子数据中的密码必须使用 `@repo/shared` 的 `hashPassword()` 哈希，不能存明文
- 种子数据的 ID 使用 `generateId()` 生成，不要硬编码固定 ID
- seed.ts 是幂等的：重复执行先清空再插入，不会产生重复数据
- stock-sync.ts 有 dryRun 模式，默认不写入，只输出报告
- Lua 文件读取路径注意 Bun 的 `__dirname` 行为，必要时用 `import.meta.dir`
