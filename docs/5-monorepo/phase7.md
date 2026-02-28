# Phase 7: apps/api-gateway — 网关整合 + 端到端测试

## 前置条件
Phase 6 已完成。请先确认：
- user-service (:3001)、product-service (:3002)、cart-service (:3003)、order-service (:3004) 全部测试通过
- 所有服务的外部路由和内部路由均就绪
- Docker 中 PostgreSQL 和 Redis 运行中

## 本次任务
实现 API Gateway（:3000）：路由转发、完整中间件链（CORS + 限流 + 鉴权 + 幂等）、健康检查、安全防护。
编写端到端测试覆盖完整购买流程。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `CLAUDE.md`（中间件顺序 + API 设计）
- `docs/architecture.md` 第 2.5 节（Gateway 边界）+ 第 7.3 节（完整路由表）+ 第 12 章（安全清单）

### 第二步：安装依赖
```bash
cd apps/api-gateway
bun add hono @repo/shared @repo/database
bun add -d typescript @types/bun
```

### 第三步：搭建目录结构

```
apps/api-gateway/src/
├── index.ts                  # 主入口
├── proxy/
│   └── forward.ts            # 通用 HTTP 转发函数
├── routes/
│   ├── registry.ts           # 路由→服务映射注册表
│   └── health.ts             # /health 健康检查
├── middleware/
│   ├── cors.ts               # CORS
│   ├── rate-limit.ts         # Redis 滑动窗口限流
│   ├── auth-gate.ts          # 鉴权网关（区分公开/认证路由）
│   ├── idempotent-gate.ts    # 幂等网关（仅对特定路由生效）
│   └── block-internal.ts     # 拦截 /internal/* 外部访问
└── config/
    └── public-routes.ts      # 公开路由白名单
```

### 第四步：实现通用转发函数

**`proxy/forward.ts`**
```typescript
// 通用 HTTP 代理转发

async function forwardRequest(
  c: Context,
  targetBaseUrl: string
): Promise<Response>
  // 1. 构建目标 URL：targetBaseUrl + c.req.path
  //    例：http://user-service:3001 + /api/v1/auth/login
  //
  // 2. 构建转发 headers：
  //    → 复制原始请求的 Content-Type, Authorization, X-Idempotency-Key
  //    → 注入网关 headers：
  //       x-trace-id: c.get("traceId")
  //       x-user-id: c.get("userId") || ""
  //       x-user-email: c.get("userEmail") || ""
  //       x-internal-token: INTERNAL_SECRET（环境变量）
  //    → 删除 Host header（避免下游校验失败）
  //
  // 3. 转发请求：
  //    fetch(targetUrl, {
  //      method: "POST",       // 全部 POST
  //      headers: forwardHeaders,
  //      body: c.req.raw.body,  // 直接 stream 转发，不解析 body
  //    })
  //
  // 4. 构建响应：
  //    → 复制下游响应的 status, headers
  //    → 注入 x-trace-id 到响应 header
  //    → 返回 Response

  // 5. 下游不可达：返回 503 + GATEWAY_9002 SERVICE_UNAVAILABLE
```

### 第五步：实现路由注册表

**`routes/registry.ts`**
```typescript
// 路由前缀 → 下游服务 URL 映射

type ServiceRoute = {
  prefix: string;
  target: string;
};

export const ROUTE_REGISTRY: ServiceRoute[] = [
  // User Service
  { prefix: "/api/v1/auth",           target: "http://localhost:3001" },
  { prefix: "/api/v1/user",           target: "http://localhost:3001" },

  // Product Service
  { prefix: "/api/v1/product",        target: "http://localhost:3002" },
  { prefix: "/api/v1/category",       target: "http://localhost:3002" },

  // Cart Service
  { prefix: "/api/v1/cart",           target: "http://localhost:3003" },

  // Order Service
  { prefix: "/api/v1/order",          target: "http://localhost:3004" },
  { prefix: "/api/v1/payment",        target: "http://localhost:3004" },

  // Admin 二级分发
  { prefix: "/api/v1/admin/product",  target: "http://localhost:3002" },
  { prefix: "/api/v1/admin/category", target: "http://localhost:3002" },
  { prefix: "/api/v1/admin/stock",    target: "http://localhost:3002" },
  { prefix: "/api/v1/admin/order",    target: "http://localhost:3004" },
];

// 端口从环境变量读取，上面的 localhost:300x 用 getConfig() 动态构建
// Docker 环境中替换为 service 名：http://user-service:3001

export function findTarget(path: string): string | null
  // 按 prefix 最长匹配，返回目标 URL
  // 例：/api/v1/admin/product/create → http://localhost:3002
```

### 第六步：实现公开路由白名单

**`config/public-routes.ts`**
```typescript
// 不需要 JWT 认证的路由路径

export const PUBLIC_ROUTES: string[] = [
  // 认证
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",

  // 商品浏览（公开）
  "/api/v1/product/list",
  "/api/v1/product/detail",
  "/api/v1/product/search",
  "/api/v1/product/sku/list",

  // 分类（公开）
  "/api/v1/category/list",
  "/api/v1/category/detail",
  "/api/v1/category/tree",

  // 支付回调（三方调用，签名验证而非 JWT）
  "/api/v1/payment/notify",

  // 健康检查
  "/health",
];

export function isPublicRoute(path: string): boolean
  // 精确匹配或前缀匹配
```

### 第七步：实现中间件

**7a. `middleware/cors.ts`**
```typescript
import { cors } from "hono/cors";

export const corsMiddleware = cors({
  origin: (origin) => {
    // 开发环境允许 localhost
    // 生产环境读取白名单环境变量 CORS_ORIGINS
    const allowed = [
      "http://localhost:3000",
      "http://localhost:5173",  // Vite dev
      // ...从环境变量读取
    ];
    return allowed.includes(origin) ? origin : "";
  },
  allowMethods: ["POST", "OPTIONS"],  // 全 POST 架构
  allowHeaders: ["Content-Type", "Authorization", "X-Idempotency-Key", "X-Request-Id"],
  exposeHeaders: ["X-Request-Id", "X-Trace-Id"],
  maxAge: 86400,
  credentials: true,
});
```

**7b. `middleware/rate-limit.ts`**
```typescript
import { redis } from "@repo/database";

// Redis 滑动窗口限流

type RateLimitConfig = {
  windowMs: number;       // 窗口大小（毫秒）
  maxRequests: number;    // 窗口内最大请求数
};

const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  anonymous:  { windowMs: 60_000, maxRequests: 100 },   // IP 维度
  authenticated: { windowMs: 60_000, maxRequests: 300 }, // userId 维度
  paymentNotify: { windowMs: 60_000, maxRequests: 500 }, // 支付回调更宽松
};

export async function rateLimitMiddleware(c, next):
  // 1. 确定限流维度：
  //    → 已认证（c.get("userId") 存在）→ key = gateway:ratelimit:user:{userId}
  //    → 未认证 → key = gateway:ratelimit:{ip}
  //    → payment/notify → 使用 paymentNotify 配置
  //
  // 2. Redis 滑动窗口实现：
  //    now = Date.now()
  //    key = "gateway:ratelimit:{dimension}"
  //    pipe = redis.pipeline()
  //    pipe.zremrangebyscore(key, 0, now - windowMs)   // 移除窗口外的记录
  //    pipe.zadd(key, now, `${now}:${random}`)         // 添加当前请求
  //    pipe.zcard(key)                                  // 统计窗口内请求数
  //    pipe.pexpire(key, windowMs)                      // 设置过期
  //    results = await pipe.exec()
  //    count = results[2]
  //
  // 3. 超限：
  //    → 设置响应 headers：X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After
  //    → 抛出 RateLimitError(RATE_LIMITED)
  //
  // 4. 未超限：
  //    → 设置响应 headers
  //    → await next()
```

**7c. `middleware/auth-gate.ts`**
```typescript
import { createAuthMiddleware } from "@repo/shared";
import { redis } from "@repo/database";
import { isPublicRoute } from "../config/public-routes";

const authMiddleware = createAuthMiddleware(redis);

export async function authGate(c, next):
  // 公开路由：跳过认证
  if (isPublicRoute(c.req.path)) {
    return next();
  }

  // 有 Authorization header：执行认证
  // 无 header：抛 401
  return authMiddleware(c, next);
```

**7d. `middleware/idempotent-gate.ts`**
```typescript
import { createIdempotentMiddleware } from "@repo/shared";
import { redis } from "@repo/database";

const idempotentMiddleware = createIdempotentMiddleware(redis);

// 需要幂等检查的路由
const IDEMPOTENT_ROUTES = [
  "/api/v1/order/create",
  "/api/v1/payment/create",
];

export async function idempotentGate(c, next):
  if (IDEMPOTENT_ROUTES.includes(c.req.path)) {
    return idempotentMiddleware(c, next);
  }
  return next();
```

**7e. `middleware/block-internal.ts`**
```typescript
// 拦截外部对 /internal/* 的访问

export async function blockInternal(c, next):
  if (c.req.path.startsWith("/internal/")) {
    throw new ForbiddenError("Internal API not accessible externally");
  }
  return next();
```

### 第八步：实现健康检查

**`routes/health.ts`**
```typescript
// POST /health — 聚合所有下游服务 + 基础设施状态

async function healthCheck(c):
  const checks = {
    gateway: "ok",
    postgres: "unknown",
    redis: "unknown",
    userService: "unknown",
    productService: "unknown",
    cartService: "unknown",
    orderService: "unknown",
  };

  // 并行检查
  const [pgResult, redisResult, ...serviceResults] = await Promise.allSettled([
    // PG: 简单查询
    db.execute(sql`SELECT 1`).then(() => "ok").catch(() => "down"),
    // Redis: PING
    redis.ping().then(() => "ok").catch(() => "down"),
    // 各服务: POST /health
    fetch("http://localhost:3001/health", { method: "POST", signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? "ok" : "down").catch(() => "down"),
    fetch("http://localhost:3002/health", { method: "POST", signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? "ok" : "down").catch(() => "down"),
    fetch("http://localhost:3003/health", { method: "POST", signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? "ok" : "down").catch(() => "down"),
    fetch("http://localhost:3004/health", { method: "POST", signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? "ok" : "down").catch(() => "down"),
  ]);

  // 汇总
  checks.postgres = pgResult.status === "fulfilled" ? pgResult.value : "down";
  checks.redis = redisResult.status === "fulfilled" ? redisResult.value : "down";
  checks.userService = serviceResults[0]?.status === "fulfilled" ? serviceResults[0].value : "down";
  checks.productService = serviceResults[1]?.status === "fulfilled" ? serviceResults[1].value : "down";
  checks.cartService = serviceResults[2]?.status === "fulfilled" ? serviceResults[2].value : "down";
  checks.orderService = serviceResults[3]?.status === "fulfilled" ? serviceResults[3].value : "down";

  const allOk = Object.values(checks).every(v => v === "ok");
  const status = allOk ? 200 : 503;

  return c.json({ status: allOk ? "healthy" : "degraded", checks }, status);
```

### 第九步：组装 App 入口

**`src/index.ts`**
```typescript
import { Hono } from "hono";
import { requestId, logger, errorHandler } from "@repo/shared";
import { corsMiddleware } from "./middleware/cors";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { authGate } from "./middleware/auth-gate";
import { idempotentGate } from "./middleware/idempotent-gate";
import { blockInternal } from "./middleware/block-internal";
import { ROUTE_REGISTRY, findTarget } from "./routes/registry";
import { healthCheck } from "./routes/health";
import { forwardRequest } from "./proxy/forward";

const app = new Hono();

// ── 中间件链（严格按顺序）──
app.use("*", requestId);           // 1. traceId 注入
app.use("*", logger);              // 2. 请求日志
app.use("*", corsMiddleware);      // 3. CORS
app.use("*", blockInternal);       // 4. 拦截 /internal/*
app.use("*", rateLimitMiddleware); // 5. 限流
app.use("*", authGate);            // 6. 鉴权（公开路由跳过）
app.use("*", idempotentGate);      // 7. 幂等（仅特定路由）
app.onError(errorHandler);         // 8. 全局错误处理

// ── 健康检查 ──
app.post("/health", healthCheck);

// ── 路由转发（通配符捕获所有 /api/v1/* 请求）──
app.all("/api/v1/*", async (c) => {
  const target = findTarget(c.req.path);
  if (!target) {
    throw new NotFoundError("Route not found");
  }
  return forwardRequest(c, target);
});

// ── 404 ──
app.all("*", (c) => {
  throw new NotFoundError("Not Found");
});

export default {
  port: Number(process.env.API_GATEWAY_PORT) || 3000,
  fetch: app.fetch,
};
```

### 第十步：编写测试

**`src/__tests__/routing.test.ts` — 路由转发测试**
```
前置：所有下游服务运行中

1. POST /api/v1/auth/login → 转发到 :3001，返回正确
2. POST /api/v1/product/list → 转发到 :3002，返回正确
3. POST /api/v1/cart/list（带 token）→ 转发到 :3003
4. POST /api/v1/order/list（带 token）→ 转发到 :3004
5. POST /api/v1/admin/product/create（带 token）→ 转发到 :3002
6. POST /api/v1/admin/order/list（带 token）→ 转发到 :3004
7. POST /api/v1/nonexistent → 404
8. POST /internal/user/detail → 403（外部不可访问）
9. 响应中包含 X-Request-Id header
10. 下游收到的请求包含 x-trace-id + x-user-id headers
```

**`src/__tests__/auth-gate.test.ts` — 鉴权测试**
```
1. 公开路由（/auth/login）无 token → 正常转发
2. 公开路由（/product/list）无 token → 正常转发
3. 认证路由（/cart/list）无 token → 401
4. 认证路由（/cart/list）有效 token → 正常转发
5. 认证路由 token 过期 → 401
6. 认证路由 token 在黑名单 → 401
```

**`src/__tests__/rate-limit.test.ts` — 限流测试**
```
1. 匿名请求连续 100 次 → 全部成功
2. 第 101 次 → 429 + X-RateLimit-Remaining: 0 + Retry-After header
3. 等待窗口过期 → 恢复正常
4. 认证用户连续 300 次 → 全部成功
5. 第 301 次 → 429
6. 响应包含 X-RateLimit-Limit 和 X-RateLimit-Remaining headers
```

**`src/__tests__/health.test.ts`**
```
1. 所有服务运行 → { status: "healthy", checks: { 全部 "ok" } }
2. 停掉一个服务 → { status: "degraded", checks: { 该服务 "down" } }
```

**`src/__tests__/e2e-flow.test.ts` — 端到端全流程 ⭐**
```
这是最终的集成验证，通过 Gateway(:3000) 走完整购买链路。
所有请求都发到 http://localhost:3000。

1.  注册
    POST /api/v1/auth/register
    → 200 + user + tokens

2.  登录
    POST /api/v1/auth/login
    → 200 + accessToken + refreshToken

3.  浏览商品
    POST /api/v1/product/list
    → 200 + 商品列表

4.  商品详情
    POST /api/v1/product/detail { id }
    → 200 + 商品 + SKU + 图片

5.  搜索商品
    POST /api/v1/product/search { keyword: "iPhone" }
    → 200 + 搜索结果

6.  分类树
    POST /api/v1/category/tree
    → 200 + 嵌套分类

7.  加入购物车
    POST /api/v1/cart/add { skuId, quantity: 2 }
    → 200

8.  查看购物车
    POST /api/v1/cart/list
    → 200 + 购物车列表（含实时价格对比）

9.  结算预览
    POST /api/v1/cart/checkout/preview
    → 200 + summary + canCheckout=true

10. 创建订单
    POST /api/v1/order/create + X-Idempotency-Key
    { items, addressId }
    → 200 + orderId + payAmount
    验证：Redis 库存已扣减
    验证：购物车已清理

11. 订单列表
    POST /api/v1/order/list
    → 200 + 包含刚创建的订单（status=pending）

12. 发起支付
    POST /api/v1/payment/create { orderId, method: "mock" }
    → 200 + paymentId

13. 模拟支付回调
    POST /api/v1/payment/notify { orderId, transactionId, status: "success", amount }
    → 200
    验证：订单状态变 paid

14. 查询支付
    POST /api/v1/payment/query { orderId }
    → 200 + payment records

15. 管理员发货
    POST /api/v1/admin/order/ship { orderId }
    → 200 + 订单状态 shipped

16. 订单详情
    POST /api/v1/order/detail { orderId }
    → 200 + 完整信息（items + address + payment + status=shipped）

17. traceId 一致性验证
    → 每个响应的 traceId 字段 === 响应 header X-Request-Id
    → 同一步骤的 traceId 在 gateway 日志和 service 日志中一致

全流程验证：
- 总共 17 步全部返回预期状态码
- 所有认证路由正确传递 userId
- 所有响应格式符合：{ code, success, data, message, traceId }
```

### 第十一步：验证
```bash
docker compose up -d

# 启动全部服务
cd services/user-service && bun run src/index.ts &
cd services/product-service && bun run src/index.ts &
cd services/cart-service && bun run src/index.ts &
cd services/order-service && bun run src/index.ts &
sleep 2

# 执行种子数据（如果需要）
cd packages/database && bun run seed
cd ../..

# 启动 Gateway
cd apps/api-gateway && bun run src/index.ts &
sleep 1

# 运行测试
bun test

# 手动健康检查
curl -s -X POST http://localhost:3000/health | jq .

# 手动全流程（快速验证）
curl -s -X POST http://localhost:3000/api/v1/product/list \
  -H "Content-Type: application/json" \
  -d '{"page":1}' | jq .

# 验证内部路由被拦截
curl -s -X POST http://localhost:3000/internal/user/detail \
  -H "Content-Type: application/json" \
  -d '{"id":"test"}' | jq .
# 应该返回 403

kill %1 %2 %3 %4 %5
```

### 第十二步：输出报告
- 文件清单 + 目录树
- 全部测试结果
- 端到端全流程 17 步执行结果
- 限流测试数据
- 健康检查输出示例
- Phase 7 完成确认 ✅
- Phase 8 预告：Docker 部署 + Caddy + 性能调优 + 冒烟测试

## 重要约束
- Gateway 不解析请求 body（除了 error-handler 需要时），直接 stream 转发到下游
- 中间件顺序严格：request-id → logger → cors → block-internal → rate-limit → auth-gate → idempotent-gate → error-handler
- 公开路由白名单维护在一个文件中，新增路由时只需加一行
- 限流使用 Redis 滑动窗口（ZSET），不是简单计数器
- /internal/* 从外部一律返回 403，不暴露任何信息
- 转发时注入 x-internal-token，下游服务可选校验
- 健康检查对下游服务设 3 秒超时，单个服务故障不影响整体响应
- Docker 环境中服务地址用 service name（user-service:3001），本地开发用 localhost
- 路由匹配使用最长前缀匹配（admin/product 优先于 admin）
