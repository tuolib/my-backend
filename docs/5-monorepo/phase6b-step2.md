# Phase 6b — Step 2: services/order-service 支付回调 + 超时取消 + 并发测试

## 前置条件
Phase 6b Step 1 已完成。请先确认：
- 订单创建 → 列表 → 详情 → 取消 全流程测试通过
- 状态机所有合法/非法流转测试通过
- product-service /internal/stock/confirm 接口就绪
- Docker 中 PostgreSQL 和 Redis 运行中

## 本次任务
实现支付回调处理、超时自动取消定时任务、并发下单压测。完成后 Phase 6 整体交付。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `docs/architecture.md` 第 8.1 节（支付成功后 stock/confirm 流程）+ 第 8.4 节（订单超时自动取消）+ 第 8.5 节（支付回调幂等）
- `docs/architecture.md` 第 3.5 节（payment_records 表结构）

### 第二步：实现 Payment Repository

**`repositories/payment.repo.ts`**
```typescript
findByOrderId(orderId: string): Promise<PaymentRecord[]>

findByTransactionId(transactionId: string): Promise<PaymentRecord | null>
  // 幂等检查用

create(data: NewPaymentRecord): Promise<PaymentRecord>

updateStatus(id: string, status: string, extra?: Partial<PaymentRecord>): Promise<void>
```

### 第三步：实现 Payment Service

**`services/payment.service.ts`**

```typescript
// ═══════════════════════════════════════════════════
// createPayment — 发起支付（返回支付参数给前端）
// ═══════════════════════════════════════════════════

async function createPayment(
  userId: string, orderId: string, method: string
): Promise<PaymentInfo>
  // 1. 查订单 → 校验归属 + 状态必须是 pending
  // 2. 检查订单是否超时（expires_at < now）→ 抛 ValidationError(ORDER_EXPIRED)
  // 3. 创建 payment_record（status=pending）
  // 4. 根据 method 生成支付参数（预留，当前模拟返回）
  //    返回：{ paymentId, method, amount, payUrl: "mock://pay/..." }
  //    真实对接时替换为 Stripe/支付宝 SDK 调用


// ═══════════════════════════════════════════════════
// handleNotify — 支付回调（三方异步通知）
// ═══════════════════════════════════════════════════

async function handleNotify(
  body: PaymentNotifyInput
): Promise<{ success: boolean }>
  // 第 1 步：签名验证（预留）
  //   当前阶段跳过，留 TODO 注释标记
  //   真实对接时在此验证三方签名

  // 第 2 步：幂等检查
  //   paymentRepo.findByTransactionId(body.transactionId)
  //   → 已存在且 status=success → 直接返回 { success: true }（幂等）
  //   → 已存在且 status=failed → 也返回（不重复处理）

  // 第 3 步：查订单
  //   orderRepo.findById(body.orderId)
  //   → 不存在 → 记录告警日志，返回 success（不让三方重试）
  //   → 状态非 pending → 记录告警日志，返回 success

  // 第 4 步：更新 payment_record
  //   paymentRepo.create 或 update：
  //     status = body.status（success / failed）
  //     transaction_id = body.transactionId
  //     raw_notify = body（完整原始报文，JSONB 审计）

  // 第 5 步：支付成功 → 更新订单状态
  //   if (body.status === "success") {
  //     assertTransition(order.status, PAID)
  //     orderRepo.updateStatus(orderId, PAID, order.version, { paidAt: now(), paymentNo: transactionId })
  //
  //     // 第 6 步：库存确认（DB 乐观锁最终一致）
  //     const items = await orderItemRepo.findByOrderId(orderId)
  //     await productClient.confirmStock(
  //       items.map(i => ({ skuId: i.skuId, quantity: i.quantity })),
  //       orderId
  //     )
  //
  //     // 第 7 步：移除超时 ZSET
  //     await redis.zrem("order:timeout", orderId)
  //
  //     // 第 8 步：更新商品销量（best effort）
  //     // 暂不实现，留 TODO
  //   }

  // 返回 { success: true }


// ═══════════════════════════════════════════════════
// queryPayment — 查询支付状态
// ═══════════════════════════════════════════════════

async function queryPayment(userId: string, orderId: string): Promise<PaymentStatus>
  // 查 order + payment_records
  // 返回：{ orderId, orderStatus, payments: [...] }
```

### 第四步：实现超时自动取消

**`services/timeout.service.ts`**

```typescript
import { redis } from "@repo/database";

// 超时检查器（定时任务）
// 每 10 秒执行一次，检查 order:timeout ZSET 中过期的订单

export class OrderTimeoutChecker {
  private timer: Timer | null = null;
  private running = false;
  private intervalMs = 10_000;   // 10 秒
  private batchSize = 50;        // 每批处理数量

  start(): void {
    if (this.timer) return;
    console.log("[TIMEOUT] Checker started, interval=%dms", this.intervalMs);
    this.timer = setInterval(() => this.check(), this.intervalMs);
    // 启动时立即执行一次
    this.check();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[TIMEOUT] Checker stopped");
    }
  }

  // 测试用：可调整间隔
  setInterval(ms: number): void { this.intervalMs = ms; }

  private async check(): Promise<void> {
    if (this.running) return;    // 防止重叠执行
    this.running = true;

    try {
      const now = Date.now() / 1000;  // Unix timestamp（秒）

      // 从 ZSET 取出过期的 orderId
      const expiredOrderIds = await redis.zrangebyscore(
        "order:timeout", 0, now, "LIMIT", 0, this.batchSize
      );

      if (expiredOrderIds.length === 0) {
        this.running = false;
        return;
      }

      console.log("[TIMEOUT] Found %d expired orders", expiredOrderIds.length);

      for (const orderId of expiredOrderIds) {
        await this.cancelExpiredOrder(orderId);
      }
    } catch (err) {
      console.error("[TIMEOUT] Check failed:", err);
    } finally {
      this.running = false;
    }
  }

  private async cancelExpiredOrder(orderId: string): Promise<void> {
    try {
      // 1. 查订单
      const order = await orderRepo.findById(orderId);
      if (!order) {
        await redis.zrem("order:timeout", orderId);
        return;
      }

      // 2. 仅处理 pending 状态（可能已被用户取消或已支付）
      if (order.status !== OrderStatus.PENDING) {
        await redis.zrem("order:timeout", orderId);
        return;
      }

      // 3. 更新状态 → cancelled
      const updated = await orderRepo.updateStatus(
        orderId, OrderStatus.CANCELLED, order.version,
        { cancelledAt: new Date(), cancelReason: "支付超时自动取消" }
      );

      if (!updated) {
        // 乐观锁冲突（可能同时被用户取消/支付），下次循环再检查
        console.warn("[TIMEOUT] Optimistic lock conflict for order %s", orderId);
        return;
      }

      // 4. 释放库存
      const items = await orderItemRepo.findByOrderId(orderId);
      await productClient.releaseStock(
        items.map(i => ({ skuId: i.skuId, quantity: i.quantity })),
        orderId
      );

      // 5. 从 ZSET 移除
      await redis.zrem("order:timeout", orderId);

      console.log("[TIMEOUT] Order %s auto-cancelled, stock released", orderId);

    } catch (err) {
      console.error("[TIMEOUT] Failed to cancel order %s:", orderId, err);
      // 不从 ZSET 移除，下次循环重试
    }
  }
}
```

### 第五步：实现 Zod Schema

**`schemas/payment.schema.ts`**
```typescript
createPaymentSchema = z.object({
  orderId: z.string().min(1),
  method: z.enum(["stripe", "alipay", "wechat", "mock"]).default("mock"),
});

paymentNotifySchema = z.object({
  orderId: z.string().min(1),
  transactionId: z.string().min(1),
  status: z.enum(["success", "failed"]),
  amount: z.number().positive(),
  method: z.string(),
  rawData: z.record(z.unknown()).optional(),  // 原始报文
});

queryPaymentSchema = z.object({
  orderId: z.string().min(1),
});
```

### 第六步：实现路由层

**完善 `routes/payment.ts`**
```typescript
const payment = new Hono();

// POST /api/v1/payment/create — 需要认证
payment.post("/create", authMiddleware, validate(createPaymentSchema), async (c) => {
  const userId = c.get("userId");
  const input = c.get("validated");
  const result = await paymentService.createPayment(userId, input.orderId, input.method);
  return c.json(success(result));
});

// POST /api/v1/payment/notify — 公开（三方回调，但需签名验证）
payment.post("/notify", validate(paymentNotifySchema), async (c) => {
  const body = c.get("validated");
  const result = await paymentService.handleNotify(body);
  return c.json(success(result));
});

// POST /api/v1/payment/query — 需要认证
payment.post("/query", authMiddleware, validate(queryPaymentSchema), async (c) => {
  const userId = c.get("userId");
  const input = c.get("validated");
  const result = await paymentService.queryPayment(userId, input.orderId);
  return c.json(success(result));
});
```

### 第七步：更新 App 入口

**更新 `src/index.ts`**
```typescript
import { OrderTimeoutChecker } from "./services/timeout.service";

// ... app 配置 ...

// 启动超时检查器
const timeoutChecker = new OrderTimeoutChecker();
timeoutChecker.start();

// Graceful shutdown
process.on("SIGTERM", () => {
  timeoutChecker.stop();
  process.exit(0);
});
```

### 第八步：编写测试

**`src/__tests__/payment.test.ts`**
```
前置：创建一个 pending 订单

1. 发起支付 → 返回 paymentId + payUrl
2. 对已超时订单发起支付 → 422 ORDER_EXPIRED
3. 对非 pending 订单发起支付 → 422 ORDER_STATUS_INVALID

支付回调：
4. 模拟成功回调 → 订单状态变 paid + payment_record 创建 + stock confirm 被调用
5. 同一 transactionId 再次回调 → 幂等，不重复处理，返回 success
6. 模拟失败回调 → payment_record status=failed，订单状态不变

查询支付：
7. 查询已支付订单 → 返回支付记录
8. 查询别人的订单 → 404
```

**`src/__tests__/timeout.test.ts`**
```
关键：测试中将超时时间缩短到 2 秒，而非 30 分钟

1. 创建订单时设置 expires_at = now + 2s（通过环境变量或测试参数控制）
2. 等待 3 秒
3. 手动调用 timeoutChecker.check()（或等定时器触发）
4. 验证：订单状态变 cancelled + cancel_reason = "支付超时自动取消"
5. 验证：Redis 库存已释放
6. 验证：order:timeout ZSET 中已移除

边界：
7. 已支付的订单到超时时间 → 不处理（状态非 pending，跳过）
8. 已被用户取消的订单 → 不处理（跳过）
```

**`src/__tests__/order-concurrent.test.ts` — 并发下单压测 ⚡️**
```
这是订单域最重要的测试。

测试场景 1：同一 SKU 并发下单
  - SKU 库存 = 10
  - 并发 20 个用户同时下单，每单买 1 个
  - 预期：10 个成功 + 10 个 STOCK_INSUFFICIENT
  - 验证：Redis 库存 = 0
  - 验证：DB 中 order 表有且仅有 10 条 pending 记录
  - 验证：stock_operations 表有 10 条 reserve 记录

测试场景 2：同一用户重复提交（幂等）
  - 同一个 idempotencyKey 并发 10 次
  - 预期：只创建 1 个订单，库存只扣 1 次
  - 其余 9 次返回原订单信息

测试场景 3：下单 + 取消 并发
  - 用户 A 下单（库存 5，买 3）→ 成功
  - 同时用户 A 取消该订单
  - 同时用户 B 下单（买 3）
  - 验证：无论谁先执行，最终库存准确
  - 验证：不存在库存"泄漏"（扣了没还，或还了没扣）

实现方式：
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      fetch("http://localhost:3004/api/v1/order/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${tokens[i]}`,
          "X-Idempotency-Key": `concurrent-test-${i}`,
        },
        body: JSON.stringify({ items: [{ skuId, quantity: 1 }], addressId }),
      }).then(r => r.json())
    )
  );
```

**`src/__tests__/full-flow.test.ts` — 端到端全流程**
```
完整的购买流程测试：

1. 用户注册/登录 → 获取 token
2. 浏览商品列表 → 获取 SKU
3. 加入购物车 → 成功
4. 结算预览 → 获取金额 + canCheckout=true
5. 创建订单 → 成功（库存已扣，购物车已清理）
6. 发起支付 → 获取 payUrl
7. 模拟支付回调 → 订单变 paid + stock confirm
8. 管理员发货 → 订单变 shipped
9. 确认收货 → delivered → completed

验证全链路中每一步的数据一致性。
```

### 第九步：验证
```bash
docker compose up -d

# 启动所有依赖服务
cd services/user-service && bun run src/index.ts &
cd services/product-service && bun run src/index.ts &
cd services/cart-service && bun run src/index.ts &
sleep 2

cd services/order-service

# 基础测试
bun test src/__tests__/payment.test.ts
bun test src/__tests__/timeout.test.ts

# 并发测试
bun test src/__tests__/order-concurrent.test.ts

# 全流程测试
bun test src/__tests__/full-flow.test.ts

# 全部测试
bun test

kill %1 %2 %3
```

### 第十步：输出报告
- 文件清单
- 全部测试结果
- 并发测试数据：
  - 场景 1：20 并发 → X 成功 / Y 失败 / 最终库存
  - 场景 2：10 次重复 → 只创建 1 单
  - 场景 3：下单+取消 → 库存最终值
- 超时取消演示日志
- Phase 6 完成确认 ✅（cart-service + order-service 全部交付）
- Phase 7 预告：api-gateway（路由转发 + 中间件链 + 端到端联调）

## 重要约束
- 支付回调必须幂等：同一 transactionId 多次调用结果一致
- 支付回调是公开接口（三方调用），不走 auth 中间件，但需签名验证（当前阶段预留 TODO）
- 回调中无论处理成功失败，都返回 success 给三方（避免三方无限重试）
- 超时检查器有防重叠保护（running flag），避免上一轮未完成就开始下一轮
- 超时取消中乐观锁冲突不算错误（可能同时被用户取消或支付），下轮再检查
- 超时取消失败不从 ZSET 移除（让下轮重试），成功才移除
- 并发测试中 Redis 库存绝不能为负数
- 并发测试中 DB 订单数 + 库存扣减总量必须一致（对账）
- 测试超时场景时将 expires_at 缩短为 2 秒（不要真等 30 分钟）
