# Stage 2 Step 3 — API Gateway Executor & Dispatch (Claude Prompt)

你是高并发电商 API 网关专家。项目使用 **Bun + Hono + TypeScript + Drizzle + Redis**。
你正在实现 `claude/architecture/stage2_apigateway.md` 阶段二"API 网关"的**第三步：核心执行流 & 下游调度**。

---

## 前置状态（已完成 Step 1 + Step 2）

### 目录结构

```
src/gateway/
├── types.ts          # ServiceRoute, DownstreamRoute, RateLimitConfig, CircuitBreakerConfig, AuthConfig, GatewayConfig
├── config.ts         # gatewayConfig 单例（services=[], auth/rateLimit/circuitBreaker 默认 disabled）
├── auth.ts           # gatewayAuthMiddleware (pass-through), authenticateRequest() → null, checkJwtBlacklist() → false
├── rate-limiter.ts   # gatewayRateLimitMiddleware (disabled), resolveRateLimitKey()
├── routes.ts         # gatewayRoutes: GET /health, GET /ready
├── proxy/
│   ├── router.ts     # routeTable (Map), resolveUpstream(), gatewayProxyMiddleware (502 stub)
│   └── index.ts      # barrel export
└── index.ts          # 总 barrel export
```

### 当前 `src/index.ts` 挂载顺序

```typescript
app.use('*', cors());
app.onError(globalErrorHandler);
app.route('/', gatewayRoutes);                // /health, /ready — 无 auth/rateLimit
app.use('*', gatewayRateLimitMiddleware);      // stub: disabled → pass-through
app.use('*', gatewayAuthMiddleware);           // stub: disabled → pass-through
app.use('*', gatewayProxyMiddleware);          // stub: no services → next()
app.route('/', buildRouter());                 // 业务路由
```

### 关键已有类型（`src/gateway/types.ts`，不要重复定义）

```typescript
type ServiceRoute = {
  prefix: string;       // 网关匹配前缀
  upstream: string;     // 下游服务地址
  timeout: number;      // 请求超时 (ms)
  retryEnabled: boolean;// 仅 GET 幂等请求
  retryMax: number;
  authRequired: boolean;
};

type DownstreamRoute = ServiceRoute & {
  circuitState: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureTime: number;
};

type CircuitBreakerConfig = {
  enabled: boolean;
  failureThreshold: number;
  resetTimeout: number;    // ms
};
```

### 关键已有函数（直接 import 使用，不要重写）

| 模块 | 导出 | 说明 |
|------|------|------|
| `src/gateway/proxy/router.ts` | `resolveUpstream(path): DownstreamRoute \| null` | 最长前缀匹配路由表 |
| `src/gateway/proxy/router.ts` | `routeTable: Map<string, DownstreamRoute>` | 运行时路由表（含熔断状态） |
| `src/gateway/config.ts` | `gatewayConfig` | 完整网关配置单例 |
| `src/gateway/auth.ts` | `authenticateRequest(c)` | stub → null |
| `src/gateway/rate-limiter.ts` | `resolveRateLimitKey(c)` | IP / userId key |
| `src/utils/response.ts` | `ApiResult.success(c, data, msg)` / `ApiResult.error(c, msg, code, data)` | 统一 `{ code, success, message, data }` |
| `src/lib/logger.ts` | `logger.debug/info/warn/error(msg, meta?)` | 结构化日志，自动携带 requestId |
| `src/lib/redis.ts` | `redisIns` | Redis 客户端单例 |

### 项目约定

- 所有中间件用 `createMiddleware` from `hono/factory`
- 所有错误响应用 `ApiResult.error()` → `{ code, success: false, message, data }`
- 5xx 错误自动追加 `(requestId: xxx)`（已在 `ApiResult.error` 内部处理）
- Redis 故障一律 fail-open（降级放行）
- 不引入新依赖库

---

## 第三步目标

**构建核心网关执行流**：请求经过认证 → 限流 → 路由查找 → 熔断判断 → 下游调度 → 统一响应。
Step 2 的三个中间件（auth / rate-limit / proxy）保持不变作为 Hono 层入口，第三步在它们"内部"补充真正的执行编排逻辑。

---

## 具体需求

### 1. 新建 `src/gateway/executor.ts` — 网关执行编排器

核心函数 `handleGatewayRequest(c: Context): Promise<Response | null>`，编排完整执行流：

```
认证检查 → 限流检查 → 路由查找 → 熔断判断 → 调度下游 → 返回响应
```

**详细逻辑：**

```typescript
import type { Context } from 'hono';
import { ApiResult } from '@/utils/response.ts';
import { logger } from '@/lib/logger.ts';
import { gatewayConfig } from './config.ts';
import { authenticateRequest } from './auth.ts';
import { resolveUpstream } from './proxy/router.ts';
import { dispatchToService } from './proxy/dispatch.ts';
import { checkCircuitBreaker, recordSuccess, recordFailure } from './circuit-breaker.ts';
```

执行步骤：
1. **认证**：若 `route.authRequired && gatewayConfig.auth.enabled`，调用 `authenticateRequest(c)`，返回 null 则 `ApiResult.error(c, '未提供有效认证', 401)`
2. **路由查找**：`resolveUpstream(c.req.path)`，null 则返回 `null`（表示 fall-through 到本地业务路由，**不是 404**）
3. **熔断判断**：`checkCircuitBreaker(route)` 若返回 `'open'` 则 `ApiResult.error(c, '服务暂时不可用（熔断保护）', 502, { service: route.prefix, circuitState: 'open' })`
4. **调度**：`const result = await dispatchToService(route, c)`
5. **响应处理**：
   - `result.ok` → `ApiResult.success(c, result.data, '网关转发成功')` + `recordSuccess(route)`
   - `result.timeout` → `ApiResult.error(c, '下游服务响应超时', 504, ...)` + `recordFailure(route)`
   - `result.error` → `ApiResult.error(c, '下游服务异常', 502, ...)` + `recordFailure(route)`
6. 每一步都用 `logger.info/warn/error` 记录关键节点

**返回值约定**：返回 `Response` 表示网关已处理；返回 `null` 表示无匹配路由，应 fall-through。

### 2. 新建 `src/gateway/proxy/dispatch.ts` — 下游调度器

**类型定义（加到 `types.ts`）：**

```typescript
/** 下游调度结果 */
export type DispatchResult = {
  ok: boolean;
  status: number;
  data: unknown;
  /** 是否因超时失败 */
  timeout: boolean;
  /** 耗时 (ms) */
  latency: number;
  /** 错误信息 */
  error?: string;
};
```

**函数 `dispatchToService(route: DownstreamRoute, c: Context): Promise<DispatchResult>`**

当前实现为 **模拟调度**（不调用真实 HTTP）：
- 返回 `{ ok: true, status: 200, data: { service: route.prefix, upstream: route.upstream, method: c.req.method, path: c.req.path, message: '模拟转发成功' }, timeout: false, latency: <actual elapsed ms> }`
- 用 `logger.info('Dispatching to downstream', { prefix, upstream, method, path })` 记录

**预留 TODO 注释（未来替换点）：**
```typescript
// TODO: 生产实现 —
// 1. 构建下游请求: new Request(upstreamUrl, { method, headers, body, signal: AbortSignal.timeout(route.timeout) })
// 2. 透传 headers: X-Request-ID, X-Forwarded-For, Authorization (if needed)
// 3. 重试逻辑: if (route.retryEnabled && method === 'GET' && attempt < route.retryMax) retry
// 4. 响应映射: 将下游 Response 转换为 DispatchResult
// 5. HTTP 客户端注入点: 可替换为自定义 fetch wrapper 以支持 tracing/metrics
```

### 3. 新建 `src/gateway/circuit-breaker.ts` — 熔断器状态机

提供三个函数：

- **`checkCircuitBreaker(route: DownstreamRoute): 'closed' | 'open' | 'half-open'`**
  - `circuitState === 'open'`：检查是否超过 `resetTimeout`，超过则转 `'half-open'`，否则返回 `'open'`
  - `circuitState === 'half-open'`：返回 `'half-open'`（允许一个探测请求通过）
  - `circuitState === 'closed'`：返回 `'closed'`

- **`recordSuccess(route: DownstreamRoute): void`**
  - 重置 `failureCount = 0`，`circuitState = 'closed'`
  - `logger.info('Circuit breaker reset', { prefix: route.prefix })`（仅在状态变化时记录）

- **`recordFailure(route: DownstreamRoute): void`**
  - `failureCount++`
  - 若 `failureCount >= gatewayConfig.circuitBreaker.failureThreshold && gatewayConfig.circuitBreaker.enabled`：
    - `circuitState = 'open'`，`lastFailureTime = Date.now()`
    - `logger.warn('Circuit breaker opened', { prefix, failureCount })`
  - 否则仅 `logger.warn('Downstream failure recorded', { prefix, failureCount })`

**注意**：直接修改 `route` 对象属性（它是 `routeTable` Map 中的引用），状态在进程生命周期内有效。

### 4. 改造 `src/gateway/proxy/router.ts` — 替换 502 stub

将 `gatewayProxyMiddleware` 从当前的 502 stub 改为调用 `handleGatewayRequest(c)`：

```typescript
// 改造前（Step 2 的 stub）：
export const gatewayProxyMiddleware = createMiddleware(async (c, next) => {
  const route = resolveUpstream(c.req.path);
  if (!route) { await next(); return; }
  return ApiResult.error(c, `代理转发未实现: ...`, 502, { stub: true });
});

// 改造后（Step 3）：
export const gatewayProxyMiddleware = createMiddleware(async (c, next) => {
  const result = await handleGatewayRequest(c);
  if (result) return result;   // 网关已处理（匹配到下游路由）
  await next();                // 无匹配，fall-through 到业务路由
});
```

### 5. 更新 `src/gateway/config.ts` — 取消注释示例路由

将 `services` 数组中的三个示例路由**取消注释**，让路由表有数据可供测试：

```typescript
services: [
  {
    prefix: '/api/v1/users',
    upstream: process.env.USER_SERVICE_URL || 'http://localhost:3001',
    timeout: 3000,
    retryEnabled: true,
    retryMax: 1,
    authRequired: true,
  },
  {
    prefix: '/api/v1/orders',
    upstream: process.env.ORDER_SERVICE_URL || 'http://localhost:3002',
    timeout: 3000,
    retryEnabled: true,
    retryMax: 1,
    authRequired: true,
  },
  {
    prefix: '/api/v1/payments',
    upstream: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003',
    timeout: 10000,
    retryEnabled: false,
    retryMax: 0,
    authRequired: true,
  },
],
```

### 6. 更新 barrel exports

- `src/gateway/proxy/index.ts` — 加 `export { dispatchToService } from './dispatch.ts'`
- `src/gateway/index.ts` — 加 `export { handleGatewayRequest } from './executor.ts'` 和 `export { checkCircuitBreaker, recordSuccess, recordFailure } from './circuit-breaker.ts'`

### 7. `src/gateway/types.ts` — 添加 `DispatchResult` 类型

如上述定义。

### 8. `src/index.ts` — 无变更

挂载顺序不变。`gatewayRateLimitMiddleware` 和 `gatewayAuthMiddleware` 仍然是全局 `use('*')` 中间件（disabled/pass-through）。`gatewayProxyMiddleware` 现在内部调用 `handleGatewayRequest` 而非返回 502 stub。

当请求命中 `/api/v1/users/*` 等 gateway 路由表前缀时，`gatewayProxyMiddleware` 拦截并返回模拟响应；未命中时 fall-through 到 `buildRouter()` 业务路由。

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/gateway/types.ts` | **修改** | 添加 `DispatchResult` 类型 |
| `src/gateway/config.ts` | **修改** | 取消注释 3 个示例路由 |
| `src/gateway/executor.ts` | **新建** | `handleGatewayRequest()` 编排认证→限流→路由→熔断→调度 |
| `src/gateway/circuit-breaker.ts` | **新建** | `checkCircuitBreaker()`, `recordSuccess()`, `recordFailure()` |
| `src/gateway/proxy/dispatch.ts` | **新建** | `dispatchToService()` 模拟调度 + HTTP 客户端注入点 TODO |
| `src/gateway/proxy/router.ts` | **修改** | `gatewayProxyMiddleware` 调用 `handleGatewayRequest` 替换 502 stub |
| `src/gateway/proxy/index.ts` | **修改** | 加 `dispatchToService` 导出 |
| `src/gateway/index.ts` | **修改** | 加 `handleGatewayRequest`, 熔断器函数导出 |
| `src/index.ts` | **无变更** | 挂载顺序不变 |

---

## 检查点 & 测试命令

### 类型检查
```bash
npx tsc --noEmit
# 期望：无错误
```

### 启动服务（需要 Redis + PostgreSQL 已运行）
```bash
bun run --hot src/index.ts
```

### 1. 系统路由不受影响
```bash
curl -s http://localhost:3000/health | jq .
# → { "code": 200, "success": true, "message": "网关存活", "data": { "status": "ok" } }

curl -s http://localhost:3000/ready | jq .
# → { "code": 200, "success": true, "message": "网关就绪", "data": { "status": "ready" } }
```

### 2. 网关路由 — 模拟转发成功（auth.enabled=false，不拦截认证）
```bash
curl -s http://localhost:3000/api/v1/users/123 | jq .
# → { "code": 200, "success": true, "message": "网关转发成功",
#     "data": { "service": "/api/v1/users", "upstream": "http://localhost:3001",
#               "method": "GET", "path": "/api/v1/users/123", "message": "模拟转发成功" } }

curl -s -X POST http://localhost:3000/api/v1/orders | jq .
# → { "code": 200, "success": true, "message": "网关转发成功",
#     "data": { "service": "/api/v1/orders", "upstream": "http://localhost:3002",
#               "method": "POST", "path": "/api/v1/orders", "message": "模拟转发成功" } }
```

### 3. 未匹配路由 — fall-through 到业务路由
```bash
curl -s http://localhost:3000/api/v1/account/login | jq .
# → 正常业务路由响应（非网关拦截）

curl -s http://localhost:3000/nonexistent | jq .
# → { "code": 404, "success": false, "message": "请求资源不存在", "data": null }
```

### 4. 手动启用 auth 后的 401 响应（可在代码中临时设 `auth.enabled = true`）
```bash
# 无 Bearer token 访问 authRequired 路由
curl -s http://localhost:3000/api/v1/users/123 | jq .
# → { "code": 401, "success": false, "message": "未提供有效认证", "data": null }
```

### 5. 熔断测试（需在代码中临时设 `circuitBreaker.enabled = true` 并手动触发 5 次失败）
```bash
# 连续 5 次失败后
curl -s http://localhost:3000/api/v1/users/123 | jq .
# → { "code": 502, "success": false, "message": "服务暂时不可用（熔断保护）",
#     "data": { "service": "/api/v1/users", "circuitState": "open" } }
```

---

## 限制

- **不调用真实下游服务** — `dispatchToService` 返回模拟数据
- **不引入新依赖** — 仅使用 hono, hono/factory, redis, 项目已有工具
- **不修改业务路由** — `buildRouter()` 逻辑完全不变
- **不修改 `src/index.ts` 挂载顺序** — 已在 Step 2 确定
- **复用现有工具** — `ApiResult`, `logger`, `redisIns`, 已有类型

---

## TODO 标记规范

所有 stub 实现内部必须标注 TODO，格式统一：

```typescript
// TODO: [阶段/步骤] — 简要描述
// 示例:
// TODO: Stage2-Step4 — 替换模拟调度为真实 fetch() 转发
// TODO: Stage2-Step4 — 实现 Redis 令牌桶限流替换 INCR+EXPIRE
// TODO: Stage2-Step4 — 接入 JWT verify + blacklist 校验
```
