# Phase 6b — Step 1: services/order-service 订单创建 + 状态机 + 取消

## 前置条件
Phase 6a（cart-service）已完成。请先确认：
- cart-service 全部测试通过
- product-service 内部接口就绪（/internal/product/sku/batch, /internal/stock/reserve, /internal/stock/release）
- cart-service 内部接口就绪（/internal/cart/clear-items）
- Docker 中 PostgreSQL 和 Redis 运行中

## 本次任务
实现 order-service 的核心：订单创建全流程（跨服务编排）、订单查询、订单取消、状态机。
支付和超时自动取消留给下一步。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `CLAUDE.md`（响应格式 + 幂等设计 + 库存操作规则）
- `docs/architecture.md` 第 2.4 节（Order Service 边界）+ 第 3.5 节（订单表结构）+ 第 8.1 节（库存扣减流程）+ 第 8.5 节（幂等设计）+ 第 7.3 节（order/* 路由）

### 第二步：安装依赖
```bash
cd services/order-service
bun add hono @repo/shared @repo/database zod
bun add -d typescript @types/bun
```

### 第三步：搭建目录结构

```
services/order-service/src/
├── index.ts
├── routes/
│   ├── order.ts              # /api/v1/order/*
│   ├── payment.ts            # /api/v1/payment/*（Step 2 完善）
│   ├── admin.ts              # /api/v1/admin/order/*
│   └── internal.ts           # 预留
├── services/
│   ├── order.service.ts      # 订单核心编排
│   ├── payment.service.ts    # 支付逻辑（Step 2）
│   ├── timeout.service.ts    # 超时取消（Step 2）
│   ├── product-client.ts     # 调用 product-service
│   └── cart-client.ts        # 调用 cart-service
├── repositories/
│   ├── order.repo.ts
│   ├── order-item.repo.ts
│   ├── order-address.repo.ts
│   └── payment.repo.ts       # Step 2
├── schemas/
│   ├── order.schema.ts
│   └── payment.schema.ts     # Step 2
├── state-machine/
│   └── order-status.ts       # 订单状态机
└── types/
    └── index.ts
```

### 第四步：实现状态机

**`state-machine/order-status.ts`**

```typescript
// 订单状态枚举
export enum OrderStatus {
  PENDING   = "pending",       // 待支付
  PAID      = "paid",          // 已支付
  SHIPPED   = "shipped",       // 已发货
  DELIVERED = "delivered",     // 已送达
  COMPLETED = "completed",     // 已完成
  CANCELLED = "cancelled",     // 已取消
  REFUNDED  = "refunded",     // 已退款
}

// 合法状态流转表
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]:   [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]:      [OrderStatus.SHIPPED, OrderStatus.REFUNDED],
  [OrderStatus.SHIPPED]:   [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]:  [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean
  // return TRANSITIONS[from].includes(to)

export function assertTransition(from: OrderStatus, to: OrderStatus): void
  // if (!canTransition) → 抛 ValidationError(ORDER_STATUS_INVALID)
  //   details: { from, to, allowed: TRANSITIONS[from] }
```

### 第五步：实现跨服务客户端

**`services/product-client.ts`**
```typescript
const PRODUCT_URL = `http://localhost:${process.env.PRODUCT_SERVICE_PORT || 3002}`;

async function fetchSkuBatch(skuIds: string[]): Promise<SkuDetail[]>
  // POST /internal/product/sku/batch

async function reserveStock(items: Array<{ skuId: string; quantity: number }>, orderId: string): Promise<void>
  // POST /internal/stock/reserve
  // 失败时会抛出上游的 422 STOCK_INSUFFICIENT

async function releaseStock(items: Array<{ skuId: string; quantity: number }>, orderId: string): Promise<void>
  // POST /internal/stock/release

async function confirmStock(items: Array<{ skuId: string; quantity: number }>, orderId: string): Promise<void>
  // POST /internal/stock/confirm
```

**`services/cart-client.ts`**
```typescript
const CART_URL = `http://localhost:${process.env.CART_SERVICE_PORT || 3003}`;

async function clearCartItems(userId: string, skuIds: string[]): Promise<void>
  // POST /internal/cart/clear-items
```

### 第六步：实现 Repository 层

**6a. `repositories/order.repo.ts`**
```typescript
findById(id: string): Promise<Order | null>
findByOrderNo(orderNo: string): Promise<Order | null>
findByIdempotencyKey(key: string): Promise<Order | null>

findByUserId(params: {
  userId: string; page: number; pageSize: number;
  status?: string;
}): Promise<{ items: Order[]; total: number }>

create(data: NewOrder): Promise<Order>
  // INSERT INTO orders

updateStatus(
  id: string, newStatus: OrderStatus, currentVersion: number,
  extra?: Partial<Order>
): Promise<boolean>
  // UPDATE orders SET status=:new, version=version+1, updated_at=now(), ...extra
  // WHERE id=:id AND version=:currentVersion
  // 乐观锁，返回是否成功

findExpiredPending(limit: number): Promise<Order[]>
  // SELECT * FROM orders WHERE status='pending' AND expires_at < now()
  // LIMIT :limit（Step 2 超时任务用）
```

**6b. `repositories/order-item.repo.ts`**
```typescript
createMany(items: NewOrderItem[]): Promise<OrderItem[]>
findByOrderId(orderId: string): Promise<OrderItem[]>
```

**6c. `repositories/order-address.repo.ts`**
```typescript
create(data: NewOrderAddress): Promise<OrderAddress>
findByOrderId(orderId: string): Promise<OrderAddress | null>
```

### 第七步：实现 Order Service（核心）

**`services/order.service.ts`**

```typescript
// ═══════════════════════════════════════════════════
// create — 订单创建（最核心的编排流程）
// ═══════════════════════════════════════════════════

async function create(
  userId: string, input: CreateOrderInput, idempotencyKey: string
): Promise<CreateOrderResult>

  // 第 1 步：幂等检查
  //   orderRepo.findByIdempotencyKey(idempotencyKey)
  //   → 存在：返回原订单信息（不是报错，是正常返回）

  // 第 2 步：获取 SKU 实时数据
  //   productClient.fetchSkuBatch(input.items.map(i => i.skuId))
  //   → 任一 SKU 不存在或 inactive → 抛 ValidationError(PRODUCT_UNAVAILABLE)

  // 第 3 步：服务端重新计算金额 ⚠️ 不信任前端传来的价格
  //   遍历 items：unitPrice = skuDetail.price（用实时价格）
  //   subtotal = unitPrice * quantity
  //   totalAmount = sum(subtotals)
  //   discountAmount = 0（预留）
  //   payAmount = totalAmount - discountAmount

  // 第 4 步：获取收货地址
  //   从 user-service 获取地址，或由前端直接传入地址快照
  //   生成 OrderAddress 快照

  // 第 5 步：库存预扣（Redis Lua 原子操作）
  //   productClient.reserveStock(items, orderId)
  //   → 失败（STOCK_INSUFFICIENT）：直接抛出，流程终止
  //   → 成功：继续

  // 第 6 步：PG 事务 — 创建订单全部数据
  //   db.transaction(async (tx) => {
  //     order = 创建 orders（状态 pending, expires_at = now + 30min）
  //     orderItems = 批量创建 order_items（快照数据）
  //     orderAddress = 创建 order_addresses
  //   })
  //   ⚠️ 如果事务失败 → catch 中调用 productClient.releaseStock 回滚库存

  // 第 7 步：设置超时
  //   Redis ZADD order:timeout {expires_at_timestamp} {orderId}

  // 第 8 步：清理购物车
  //   cartClient.clearCartItems(userId, skuIds)
  //   ⚠️ 这步失败不影响订单（best effort），只记录告警日志

  // 第 9 步：返回
  //   { orderId, orderNo, payAmount, expiresAt }


// ═══════════════════════════════════════════════════
// list — 用户订单列表
// ═══════════════════════════════════════════════════

async function list(userId: string, params: OrderListInput): Promise<PaginatedData<OrderListItem>>
  // 查订单列表 + 每个订单的 items（首条 + 数量）
  // 返回：orderNo, status, payAmount, itemCount, firstItemImage, createdAt


// ═══════════════════════════════════════════════════
// detail — 订单详情
// ═══════════════════════════════════════════════════

async function detail(userId: string, orderId: string): Promise<OrderDetail>
  // 查 order + orderItems + orderAddress + paymentRecords
  // 校验：order.userId === userId（防止越权查看）
  // 不存在或不属于该用户 → NotFoundError(ORDER_NOT_FOUND)


// ═══════════════════════════════════════════════════
// cancel — 用户取消订单
// ═══════════════════════════════════════════════════

async function cancel(userId: string, orderId: string, reason?: string): Promise<void>
  // 1. 查订单 + 校验归属
  // 2. 状态检查：assertTransition(order.status, CANCELLED)
  //    → 非 pending → 抛 ValidationError(ORDER_CANCEL_DENIED)
  // 3. 乐观锁更新状态 → cancelled + cancelled_at + cancel_reason
  // 4. 释放库存：productClient.releaseStock(items)
  // 5. 移除超时 ZSET：ZREM order:timeout {orderId}


// ═══════════════════════════════════════════════════
// adminList — 管理端订单列表（无 userId 过滤）
// ═══════════════════════════════════════════════════

async function adminList(params: OrderListInput): Promise<PaginatedData<OrderListItem>>

// ═══════════════════════════════════════════════════
// ship — 管理员发货
// ═══════════════════════════════════════════════════

async function ship(orderId: string, trackingNo?: string): Promise<void>
  // 1. 查订单
  // 2. assertTransition(order.status, SHIPPED)
  // 3. 更新状态 → shipped + shipped_at
```

### 第八步：实现 Zod Schema

**`schemas/order.schema.ts`**
```typescript
createOrderSchema = z.object({
  items: z.array(z.object({
    skuId: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1),
  addressId: z.string().min(1),         // 用户收货地址 ID
  remark: z.string().max(500).optional(),
});
// 注意：不接受前端传价格，服务端从 SKU 实时查询

orderListSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(10),
  status: z.enum(["pending","paid","shipped","delivered","completed","cancelled","refunded"]).optional(),
});

orderDetailSchema = z.object({ orderId: z.string().min(1) });

cancelOrderSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

shipOrderSchema = z.object({
  orderId: z.string().min(1),
  trackingNo: z.string().max(100).optional(),
});
```

### 第九步：实现路由层

**`routes/order.ts`** — 需要认证
```typescript
// POST /api/v1/order/create
//   Header 必须携带 X-Idempotency-Key
//   从 header 读取 idempotencyKey 传给 service
order.post("/create", validate(createOrderSchema), async (c) => {
  const userId = c.get("userId");
  const idempotencyKey = c.req.header("X-Idempotency-Key");
  if (!idempotencyKey) throw new BadRequestError("Missing X-Idempotency-Key header");
  const input = c.get("validated");
  const result = await orderService.create(userId, input, idempotencyKey);
  return c.json(success(result, "订单创建成功"));
});

// POST /api/v1/order/list
// POST /api/v1/order/detail
// POST /api/v1/order/cancel
```

**`routes/admin.ts`** — 需要认证（当前不检查 admin 角色，预留）
```typescript
// POST /api/v1/admin/order/list
// POST /api/v1/admin/order/ship
```

### 第十步：组装 App 入口

**`src/index.ts`**
```typescript
// 全局中间件：requestId → logger → onError(errorHandler)
// authMiddleware = createAuthMiddleware(redis)
// 路由挂载：
//   /api/v1/order → orderRoutes
//   /api/v1/payment → paymentRoutes（Step 2，先挂空路由）
//   /api/v1/admin/order → adminRoutes
// 健康检查：POST /health
// 端口：:3004
```

### 第十一步：编写集成测试

**`src/__tests__/order-create.test.ts`**
```
前置：
- user-service、product-service、cart-service 需要运行（或 mock 客户端）
- 注册+登录获取 token
- 购物车添加商品 或 直接用种子数据 SKU

1. 创建订单 → 成功
   验证：返回 orderId, orderNo, payAmount, expiresAt
   验证：DB 中 order + order_items + order_address 都已创建
   验证：Redis 库存已扣减
   验证：Redis order:timeout ZSET 中有该 orderId
   验证：购物车中该 SKU 已被清理

2. 相同 idempotencyKey 再次创建 → 返回原订单（幂等）
   验证：库存没有再次扣减

3. 不同 idempotencyKey + 库存不足 → 422 STOCK_INSUFFICIENT
   验证：订单未创建，库存未变化

4. SKU 不存在 → 422 PRODUCT_UNAVAILABLE

5. 金额验证：
   创建订单后，order.pay_amount === sum(sku.price * quantity)
   不等于前端可能传来的任何值
```

**`src/__tests__/order-query.test.ts`**
```
前置：已有创建成功的订单

1. 订单列表 → 包含刚创建的订单
2. 订单列表（按状态过滤 pending）→ 返回正确
3. 订单详情 → 返回完整信息（items + address + status）
4. 查询别人的订单 → 404（不暴露是否存在）
5. 订单不存在 → 404
```

**`src/__tests__/order-cancel.test.ts`**
```
1. 取消 pending 订单 → 成功
   验证：状态变 cancelled + cancelled_at 有值
   验证：库存已释放（Redis stock 恢复）
   验证：order:timeout ZSET 中已移除

2. 取消已取消的订单 → 422 ORDER_STATUS_INVALID

3. 取消 paid 订单 → 422 ORDER_CANCEL_DENIED
   （paid 只能走 refund，不能直接 cancel）
```

**`src/__tests__/order-state.test.ts`**
```
测试状态机所有流转：
1. pending → cancelled ✅
2. pending → paid ✅（模拟，直接调 updateStatus）
3. paid → shipped ✅
4. shipped → delivered ✅
5. delivered → completed ✅
6. pending → shipped ❌ (ORDER_STATUS_INVALID)
7. cancelled → paid ❌
8. completed → cancelled ❌
```

**`src/__tests__/order-admin.test.ts`**
```
1. 管理端订单列表 → 返回所有用户的订单
2. 管理员发货（paid → shipped）→ 成功
3. 发货非 paid 订单 → 422
```

### 第十二步：验证
```bash
docker compose up -d

# 启动依赖服务
cd services/user-service && bun run src/index.ts &
cd services/product-service && bun run src/index.ts &
cd services/cart-service && bun run src/index.ts &
sleep 2

cd services/order-service
bun test

# 手动全流程测试
bun run src/index.ts &
sleep 1

TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@test.com","password":"password123"}' | jq -r '.data.accessToken')

SKUID=$(docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -t -c \
  "SELECT id FROM product_service.skus WHERE status='active' LIMIT 1;" | tr -d ' \n')

ADDR_ID=$(docker exec -it $(docker ps -q -f name=postgres) psql -U postgres -d ecommerce -t -c \
  "SELECT id FROM user_service.user_addresses LIMIT 1;" | tr -d ' \n')

# 创建订单
curl -s -X POST http://localhost:3004/api/v1/order/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Idempotency-Key: test-$(date +%s)" \
  -d "{\"items\":[{\"skuId\":\"$SKUID\",\"quantity\":2}],\"addressId\":\"$ADDR_ID\"}" | jq .

# 订单列表
curl -s -X POST http://localhost:3004/api/v1/order/list \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"page":1}' | jq .

kill %1 %2 %3 %4
```

### 第十三步：输出报告
- 文件清单 + 目录树
- 全部测试结果
- 订单创建全流程时序（实际调用链路）
- Phase 6b Step 1 完成确认
- 下一步预告（Phase 6b Step 2）：支付回调 + 超时自动取消 + 并发下单测试

## 重要约束
- 订单创建是跨 3 个服务的编排，失败补偿很关键：
  → 库存预扣成功但 DB 事务失败 → 必须 releaseStock 回滚
  → 购物车清理失败 → 只记告警日志，不影响订单
- 金额由服务端计算，不信任前端传入的任何价格
- order_items 中所有字段都是快照（product_title, sku_attrs, image_url, unit_price），不 FK 到商品表
- order_addresses 是独立快照，不 FK 到 user_addresses
- 幂等：相同 idempotencyKey 返回原订单，不重复扣库存
- 乐观锁：订单状态更新使用 `WHERE version = :v`
- 状态机严格：非法流转一律 422 ORDER_STATUS_INVALID
- 超时 ZSET key：`order:timeout`，score = expires_at 的 Unix timestamp
