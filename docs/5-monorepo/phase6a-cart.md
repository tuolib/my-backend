# Phase 6a: services/cart-service — 购物车域（完整实现）

## 前置条件
Phase 5 已完成。请先确认：
- product-service 全部测试通过（含库存接口 + 并发测试）
- /internal/product/sku/batch 可正常批量查 SKU
- /internal/stock/* 全部内部接口就绪
- Redis 中有库存 key（stock:{skuId}）
- Docker 中 PostgreSQL 和 Redis 运行中

## 本次任务
完整实现 services/cart-service（:3003）。购物车纯 Redis 存储，不操作 PG。
通过调用 product-service 内部接口获取 SKU 实时数据。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `CLAUDE.md`（Service 分层 + 响应格式）
- `docs/architecture.md` 第 2.3 节（Cart Service 边界）+ 第 9 章全部（购物车设计）+ 第 4 章（Redis Key: `cart:{userId}`）+ 第 7.3 节（cart/* 路由）

### 第二步：安装依赖
```bash
cd services/cart-service
bun add hono @repo/shared @repo/database zod
bun add -d typescript @types/bun
```

### 第三步：搭建目录结构

```
services/cart-service/src/
├── index.ts
├── routes/
│   ├── cart.ts               # /api/v1/cart/* 路由
│   └── internal.ts           # /internal/cart/* 内部路由
├── services/
│   ├── cart.service.ts       # 购物车核心逻辑
│   └── product-client.ts     # 调用 product-service 内部接口的 HTTP 客户端
├── schemas/
│   └── cart.schema.ts
└── types/
    └── index.ts
```

注意：cart-service 不需要 repositories/ 层，因为数据全部在 Redis，直接在 service 层操作。

### 第四步：实现 Product Service 客户端

**`services/product-client.ts`**
```typescript
// 封装对 product-service 内部接口的 HTTP 调用

const PRODUCT_SERVICE_URL = `http://localhost:${process.env.PRODUCT_SERVICE_PORT || 3002}`;

async function fetchSkuBatch(skuIds: string[]): Promise<SkuDetail[]>
  // POST http://product-service:3002/internal/product/sku/batch
  // Body: { skuIds }
  // 返回: SKU 列表（含 productId, productTitle, price, stock, status, imageUrl, skuAttrs）
  // 注入 x-internal-token header

async function fetchSkuStock(skuId: string): Promise<number>
  // 直接从 Redis GET stock:{skuId}（cart-service 共享 Redis 实例）
  // 比走 HTTP 更快，购物车只需要"提示"库存，不需要锁定

// TS 类型
type SkuDetail = {
  skuId: string;
  productId: string;
  productTitle: string;
  skuCode: string;
  skuAttrs: Record<string, string>;
  price: number;
  comparePrice?: number;
  stock: number;
  status: string;          // active / inactive
  imageUrl?: string;
}
```

### 第五步：实现 Cart Service

**`services/cart.service.ts`**

Redis 数据模型：
```
Key:   cart:{userId}             (Hash)
Field: {skuId}
Value: JSON CartItem
```

```typescript
import { redis } from "@repo/database";

// ── 类型定义 ──
type CartItem = {
  skuId: string;
  quantity: number;
  selected: boolean;
  addedAt: string;                // ISO timestamp
  snapshot: {
    productId: string;
    productTitle: string;
    skuAttrs: Record<string, string>;
    price: number;
    imageUrl?: string;
  };
};

type CartListItem = CartItem & {
  // 实时数据（list/preview 时填充）
  currentPrice: number;
  currentStock: number;
  priceChanged: boolean;          // snapshot.price !== currentPrice
  unavailable: boolean;           // SKU status !== 'active'
  stockInsufficient: boolean;     // currentStock < quantity
};

// ── 方法 ──

async function add(userId: string, input: AddCartInput): Promise<void>
  // 1. 检查购物车数量上限（HLEN cart:{userId}）
  //    → 已有该 SKU：只更新数量，不算新增
  //    → 新 SKU + 已满 50：抛 ValidationError(CART_LIMIT_EXCEEDED)
  //
  // 2. 调用 productClient.fetchSkuBatch([input.skuId]) 获取实时信息
  //    → SKU 不存在或 inactive：抛 ValidationError(CART_SKU_UNAVAILABLE)
  //
  // 3. 检查库存（提示性，不锁定）
  //    → 库存不足：抛 ValidationError(STOCK_INSUFFICIENT) 带详情
  //
  // 4. 如果购物车已有该 SKU：
  //    → HGET → 解析 → 更新 quantity（累加或覆盖取决于 input.mode）
  //    → 更新 snapshot（刷新为最新价格）
  //    → HSET
  //
  // 5. 如果是新 SKU：
  //    → 构建 CartItem（snapshot 记录当前价格）
  //    → HSET cart:{userId} {skuId} {JSON}
  //
  // 6. 刷新 TTL：EXPIRE cart:{userId} 2592000（30天）

async function list(userId: string): Promise<CartListItem[]>
  // 1. HGETALL cart:{userId}
  // 2. 如果为空 → 返回 []
  // 3. 收集所有 skuId → fetchSkuBatch 批量查询实时数据
  // 4. 遍历每个 CartItem，与实时数据对比：
  //    → priceChanged: snapshot.price !== currentSku.price
  //    → unavailable: currentSku.status !== 'active' 或 SKU 不存在
  //    → stockInsufficient: currentSku.stock < item.quantity
  // 5. 按 addedAt 倒序排列（最新添加的在前）
  // 6. 返回 CartListItem[]

async function update(userId: string, skuId: string, quantity: number): Promise<void>
  // 1. HGET cart:{userId} {skuId} → 不存在抛 NotFoundError(CART_ITEM_NOT_FOUND)
  // 2. quantity <= 0 → 等同于 remove
  // 3. 检查库存（提示性）
  // 4. 更新 quantity → HSET

async function remove(userId: string, skuIds: string[]): Promise<void>
  // HDEL cart:{userId} ...skuIds

async function clear(userId: string): Promise<void>
  // DEL cart:{userId}

async function select(userId: string, skuIds: string[], selected: boolean): Promise<void>
  // 遍历 skuIds：HGET → 更新 selected → HSET
  // 不存在的 skuId 静默跳过

async function checkoutPreview(userId: string): Promise<CheckoutPreview>
  // 1. HGETALL → 过滤 selected = true 的商品
  // 2. 没有勾选商品 → 抛 ValidationError("请选择至少一件商品")
  // 3. fetchSkuBatch 获取实时数据
  // 4. 逐项校验：
  //    → 已下架：加入 unavailableItems[]
  //    → 价格变动：加入 priceChangedItems[]（含 oldPrice + newPrice）
  //    → 库存不足：加入 insufficientItems[]（含 available）
  // 5. 计算金额（用实时价格，不用快照价格）：
  //    → itemsTotal = sum(currentPrice * quantity)
  //    → shippingFee = 0（预留）
  //    → discountAmount = 0（预留）
  //    → payAmount = itemsTotal + shippingFee - discountAmount
  // 6. 返回 CheckoutPreview:
  //    {
  //      items: [...],           // 勾选商品 + 实时信息
  //      summary: { itemsTotal, shippingFee, discountAmount, payAmount },
  //      warnings: {
  //        unavailableItems,     // 下架商品（前端提示移除）
  //        priceChangedItems,    // 价格变动（前端提示确认）
  //        insufficientItems,    // 库存不足（前端提示减少数量）
  //      },
  //      canCheckout: boolean,   // 无 unavailable + 无 insufficient → true
  //    }

// ── 内部接口 ──

async function clearItems(userId: string, skuIds: string[]): Promise<void>
  // 订单创建后，清理已下单的 SKU
  // HDEL cart:{userId} ...skuIds
```

### 第六步：实现 Zod Schema

**`schemas/cart.schema.ts`**
```typescript
addCartSchema = z.object({
  skuId: z.string().min(1),
  quantity: z.number().int().positive().max(99),
});

updateCartSchema = z.object({
  skuId: z.string().min(1),
  quantity: z.number().int().min(0).max(99),  // 0 = 删除
});

removeCartSchema = z.object({
  skuIds: z.array(z.string().min(1)).min(1),
});

selectCartSchema = z.object({
  skuIds: z.array(z.string().min(1)).min(1),
  selected: z.boolean(),
});

clearItemsSchema = z.object({       // 内部接口
  userId: z.string().min(1),
  skuIds: z.array(z.string().min(1)).min(1),
});
```

### 第七步：实现路由层

**`routes/cart.ts`** — 全部需要认证
```typescript
const cart = new Hono();
cart.use("/*", authMiddleware);

// POST /api/v1/cart/add
cart.post("/add", validate(addCartSchema), async (c) => {
  const userId = c.get("userId");
  const input = c.get("validated");
  await cartService.add(userId, input);
  return c.json(success(null, "已加入购物车"));
});

// POST /api/v1/cart/list
cart.post("/list", async (c) => {
  const userId = c.get("userId");
  const items = await cartService.list(userId);
  return c.json(success(items));
});

// POST /api/v1/cart/update
// POST /api/v1/cart/remove
// POST /api/v1/cart/clear
// POST /api/v1/cart/select

// POST /api/v1/cart/checkout/preview
cart.post("/checkout/preview", async (c) => {
  const userId = c.get("userId");
  const preview = await cartService.checkoutPreview(userId);
  return c.json(success(preview));
});
```

**`routes/internal.ts`**
```typescript
// POST /internal/cart/clear-items
//   Body: { userId, skuIds }
//   被 order-service 调用，下单成功后清理购物车
```

### 第八步：组装 App 入口

**`src/index.ts`**
```typescript
// 全局中间件：requestId → logger → onError(errorHandler)
// authMiddleware = createAuthMiddleware(redis)
// 路由挂载：
//   /api/v1/cart → cartRoutes
//   /internal/cart → internalRoutes
// 健康检查：POST /health
// 端口：:3003
```

### 第九步：编写集成测试

**`src/__tests__/cart.test.ts`**

```
前置：
- product-service 需要运行（或 mock fetchSkuBatch）
- 注册+登录获取 token
- 确保种子数据中有可用的 SKU

测试用例（顺序执行）：

1. 购物车列表（空）→ 返回 []
2. 添加 SKU-A x 2 → 成功
3. 添加 SKU-B x 1 → 成功
4. 购物车列表 → 2 个商品，quantity 正确
5. 再次添加 SKU-A x 3 → quantity 变为 5（累加）
6. 更新 SKU-A quantity = 1 → 成功
7. 更新 SKU-A quantity = 0 → 等同于删除
8. 添加已下架的 SKU → 422 CART_SKU_UNAVAILABLE
9. 添加库存不足的 SKU（quantity > stock）→ 422 STOCK_INSUFFICIENT
10. 选择/取消选择 → selected 状态变化
11. 批量删除 → 指定 SKU 被移除
12. 清空购物车 → 购物车为空

购物车上限测试：
13. 连续添加 50 个不同 SKU → 成功
14. 第 51 个 → 422 CART_LIMIT_EXCEEDED
```

**`src/__tests__/checkout.test.ts`**

```
前置：购物车中有 2 个勾选商品

1. 结算预览 → 返回 items + summary（金额正确）+ canCheckout=true
2. 没有勾选商品时结算预览 → 422 提示
3. 模拟价格变动（手动改 SKU 价格后再 preview）→ priceChangedItems 不为空
4. 模拟库存不足 → insufficientItems 不为空 + canCheckout=false
```

**`src/__tests__/internal.test.ts`**

```
1. 购物车有 SKU-A + SKU-B
2. /internal/cart/clear-items { skuIds: [SKU-A] } → SKU-A 被移除，SKU-B 还在
3. 用户不存在的 cart → 静默成功（不报错）
```

### 第十步：验证
```bash
docker compose up -d

# 需要先启动 product-service（cart 依赖它的内部接口）
cd services/product-service && bun run src/index.ts &
sleep 1

cd services/cart-service
bun test

# 手动测试
bun run src/index.ts &
sleep 1

# 先登录获取 token
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@test.com","password":"password123"}' | jq -r '.data.accessToken')

# 获取一个 SKU ID
SKUID=$(docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -t -c \
  "SELECT id FROM product_service.skus WHERE status='active' LIMIT 1;" | tr -d ' \n')

# 添加到购物车
curl -s -X POST http://localhost:3003/api/v1/cart/add \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"skuId\":\"$SKUID\",\"quantity\":2}" | jq .

# 查看购物车
curl -s -X POST http://localhost:3003/api/v1/cart/list \
  -H "Authorization: Bearer $TOKEN" | jq .

# 结算预览
curl -s -X POST http://localhost:3003/api/v1/cart/checkout/preview \
  -H "Authorization: Bearer $TOKEN" | jq .

kill %1 %2  # 停止 cart + product service
```

### 第十一步：输出报告
- 文件清单 + 目录树
- 全部测试结果
- Redis 购物车数据示例（HGETALL 输出）
- Phase 6a 完成确认 ✅
- Phase 6b 预告：order-service（订单创建/状态机/支付/超时取消）

## 重要约束
- 购物车数据全部存 Redis Hash，不操作 PostgreSQL
- 购物车上限 50 个不同 SKU，超出抛 CART_LIMIT_EXCEEDED
- add 时记录价格快照，list/preview 时用实时价格对比
- 结算预览不扣库存、不创建订单，只校验 + 计算
- 结算金额用实时价格（currentPrice），不用快照价格（snapshot.price）
- canCheckout = 没有 unavailable + 没有 insufficient（价格变动只是 warning，不阻止结算）
- /internal/cart/clear-items 幂等：cart 不存在或 skuId 不在 cart 中都静默成功
- 购物车 TTL = 30 天，每次写操作刷新 TTL
- 库存检查是提示性的（直接读 Redis stock key），不锁定库存
