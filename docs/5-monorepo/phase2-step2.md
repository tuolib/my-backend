# Phase 2 — Step 2: packages/shared 中间件层（hash + jwt + 全部中间件）

## 前置条件
Phase 2 Step 1 已完成。请先确认：
- `bun test` 在 packages/shared 下全部通过
- config, errors, response, types, utils/id, utils/time 模块均已就绪
- 可以正常 `import { AppError, NotFoundError, success, error, ErrorCode, generateId } from "@repo/shared"`

## 本次任务
实现 packages/shared 剩余模块：密码哈希、JWT 工具、全部 6 个 Hono 中间件。完成后 packages/shared 整包交付。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `CLAUDE.md`（中间件顺序 + 响应格式 + API 设计约定）
- `docs/architecture.md` 第 5 章（认证设计 JWT 双 Token）+ 第 4 章（Redis Key 规范）+ 第 8.5 节（幂等设计）

### 第二步：审计现有代码
检查 packages/shared/src/ 下是否已有 middleware/、utils/hash.ts、utils/jwt.ts。
已存在的：对照架构规范检查是否一致。
缺失的：按下面的规格实现。

### 第三步：安装依赖
```bash
cd packages/shared
bun add @node-rs/argon2 jose ioredis
```
说明：
- `@node-rs/argon2`：Rust 绑定的 Argon2，比纯 JS 实现快 10x+，Bun 兼容
- `jose`：轻量 JWT 库，零依赖，支持 EdDSA/ECDSA/HMAC，Bun 原生兼容
- `ioredis`：Redis 客户端（中间件 auth 和 idempotent 需要检查 Redis）

### 第四步：实现工具模块

**4a. `src/utils/hash.ts` — 密码哈希 + SHA-256**
```typescript
// 密码哈希（Argon2id）
async function hashPassword(password: string): Promise<string>
  // 使用 @node-rs/argon2 的 hash 函数
  // 参数：Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1

async function verifyPassword(password: string, hash: string): Promise<boolean>
  // 使用 @node-rs/argon2 的 verify 函数

// SHA-256（用于 refresh token hash 存储）
function sha256(input: string): string
  // 使用 Bun 原生 crypto：new Bun.CryptoHasher("sha256")
  // 返回 hex 字符串
```

**4b. `src/utils/jwt.ts` — JWT 签发/验证**
```typescript
import * as jose from "jose";

// Access Token
async function signAccessToken(payload: { sub: string; email: string }): Promise<string>
  // 从 config 读取 JWT_ACCESS_SECRET, JWT_ACCESS_EXPIRES_IN
  // 生成 jti（用 generateId()）
  // 签发 HS256 JWT，包含 sub, email, jti, iat, exp

async function verifyAccessToken(token: string): Promise<AccessTokenPayload>
  // 验证签名 + 过期时间
  // 返回 { sub, email, jti, iat, exp }
  // 无效 token 抛出 UnauthorizedError (TOKEN_EXPIRED 或通用 401)

// Refresh Token
async function signRefreshToken(payload: { sub: string }): Promise<string>
  // 从 config 读取 JWT_REFRESH_SECRET, JWT_REFRESH_EXPIRES_IN
  // 签发 HS256 JWT

async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload>
  // 验证签名 + 过期时间
  // 返回 { sub, jti, iat, exp }

// 类型导出
type AccessTokenPayload = { sub: string; email: string; jti: string; iat: number; exp: number }
type RefreshTokenPayload = { sub: string; jti: string; iat: number; exp: number }
```

### 第五步：实现中间件

所有中间件遵循 Hono middleware 签名：`(c, next) => Promise<void | Response>`

中间件挂载顺序（在 Gateway 中）：
```
request-id → logger → cors → rate-limit → auth → idempotent → validate → [业务] → error-handler
```

**5a. `src/middleware/request-id.ts` — traceId 注入**
```
- 读取请求 header `X-Request-Id`，没有则用 generateId() 生成
- 存入 c.set("traceId", traceId)
- 设置响应 header `X-Request-Id`
- await next()
```

**5b. `src/middleware/logger.ts` — 请求日志**
```
- 记录：method, path, 开始时间
- await next()
- 记录：status, 耗时(ms)
- 格式：`[traceId] POST /api/v1/product/list → 200 (12ms)`
- 使用 console.log（生产环境可替换为结构化日志）
```

**5c. `src/middleware/error-handler.ts` — 全局异常捕获**
```
- 这是一个 onError handler，不是普通中间件
- 导出 Hono 的 app.onError 处理函数
- 捕获逻辑：
  → err instanceof AppError：
    使用 response/error() 构建响应，注入 traceId
  → 其他 Error：
    包装为 InternalError(500)，生产环境隐藏原始错误信息
    console.error 打印完整堆栈
  → 返回 c.json(errorResponse, statusCode)
- 严格使用 CLAUDE.md 定义的错误响应格式：
  { code, success: false, message, data: null, meta: { code, message, details }, traceId }
```

**5d. `src/middleware/validate.ts` — Zod 参数校验**
```
- 导出工厂函数：validate(schema: ZodSchema) => MiddlewareHandler
- 从 c.req.json() 读取 body（因为全部是 POST）
- 用 schema.safeParse(body) 校验
- 失败：抛出 ValidationError(422)，details 包含 zod 的 flatten errors
- 成功：c.set("validated", parsed.data)，await next()
```

**5e. `src/middleware/auth.ts` — JWT 鉴权**
```
- 从 Authorization header 读取 Bearer token
- 没有 token：抛出 UnauthorizedError("Missing authentication token")
- 调用 verifyAccessToken(token) 解析
- 检查 Redis 黑名单：GET user:session:blacklist:{jti}
  → 存在：抛出 UnauthorizedError(TOKEN_REVOKED)
  → 不存在：继续
- c.set("userId", payload.sub)
- c.set("userEmail", payload.email)
- c.set("tokenJti", payload.jti)
- await next()

注意：auth 中间件需要 Redis 连接。
设计方案：导出工厂函数 createAuthMiddleware(redis: Redis) => MiddlewareHandler
这样调用方（Gateway/Service）传入自己的 Redis 实例。
```

**5f. `src/middleware/idempotent.ts` — 幂等中间件**
```
- 导出工厂函数：createIdempotentMiddleware(redis: Redis) => MiddlewareHandler
- 从 header 读取 X-Idempotency-Key
- 没有 key：直接 await next()（非强制，由路由决定是否挂载此中间件）
- 有 key：
  → Redis GET order:idempotent:{key}
  → 存在：返回 409 + IDEMPOTENT_CONFLICT + 原始响应数据
  → 不存在：await next()
  → next 完成后：Redis SET order:idempotent:{key} {响应体} EX 86400
```

### 第六步：更新 `src/index.ts` 统一导出

确保所有新增模块都通过 index.ts 导出：
```typescript
// 已有（Step 1）
export * from "./config";
export * from "./errors";
export * from "./response";
export * from "./types";
export * from "./utils/id";
export * from "./utils/time";

// 新增（Step 2）
export * from "./utils/hash";
export * from "./utils/jwt";
export { requestId } from "./middleware/request-id";
export { logger } from "./middleware/logger";
export { errorHandler } from "./middleware/error-handler";
export { validate } from "./middleware/validate";
export { createAuthMiddleware } from "./middleware/auth";
export { createIdempotentMiddleware } from "./middleware/idempotent";
```

### 第七步：编写单元测试

**`src/utils/hash.test.ts`：**
- hashPassword 返回非空字符串，且不等于原密码
- verifyPassword 正确密码返回 true
- verifyPassword 错误密码返回 false
- sha256 返回 64 位 hex 字符串
- sha256 相同输入返回相同输出

**`src/utils/jwt.test.ts`：**
- signAccessToken 返回合法 JWT 字符串
- verifyAccessToken 能解析回 payload（sub, email, jti）
- 过期 token 抛出 UnauthorizedError
- 篡改 token 抛出 UnauthorizedError
- signRefreshToken + verifyRefreshToken 同理

**`src/middleware/error-handler.test.ts`：**
- AppError 子类被正确转为对应 statusCode 的响应
- NotFoundError → { code: 404, success: false, meta: { code: "..." } }
- ValidationError → { code: 422, details 包含字段信息 }
- 普通 Error → { code: 500 }
- 响应结构严格匹配：code, success, message, data, meta, traceId 全部存在

**`src/middleware/validate.test.ts`：**
- 合法 body 通过校验，c.get("validated") 有值
- 非法 body 抛出 422 + details

**`src/middleware/request-id.test.ts`：**
- 没有传 X-Request-Id 时自动生成 21 位 ID
- 传了 X-Request-Id 时使用传入的值
- 响应 header 包含 X-Request-Id

**`src/middleware/auth.test.ts`：**
- 需要 mock Redis
- 合法 token + 不在黑名单 → 通过，userId 被注入
- 合法 token + 在黑名单 → 401 TOKEN_REVOKED
- 无 token → 401
- 过期 token → 401

**`src/middleware/idempotent.test.ts`：**
- 需要 mock Redis
- 无 X-Idempotency-Key → 直接通过
- 有 key + Redis 不存在 → 通过 + 响应后写入 Redis
- 有 key + Redis 存在 → 409 IDEMPOTENT_CONFLICT

### 第八步：验证
```bash
cd packages/shared
bun test                       # 全部测试通过
cd ../..
bun install                    # workspace 正常

# 验证导出完整性（在项目根目录创建临时测试）
echo 'import { AppError, NotFoundError, success, error, validate, ErrorCode, generateId, signAccessToken, hashPassword, createAuthMiddleware, requestId, logger, errorHandler } from "@repo/shared"; console.log("All exports OK")' > /tmp/test-imports.ts
bun run /tmp/test-imports.ts   # 应该打印 "All exports OK"
rm /tmp/test-imports.ts
```

### 第九步：输出报告
- 新增/修改的文件清单
- 全部测试结果
- packages/shared 完整文件树
- Phase 2 完成确认 ✅
- Phase 3 预告：packages/database（Drizzle schema + Redis 封装 + Lua 脚本 + 迁移）

## 重要约束
- error-handler 的响应格式必须严格匹配：{ code, success, message, data, meta: { code, message, details }, traceId }
- auth 和 idempotent 中间件使用工厂函数模式（接收 Redis 实例），不在 shared 包内创建 Redis 连接
- JWT secret 从 config 模块读取，不硬编码
- 测试中 mock Redis（不依赖真实 Redis 实例），可用简单的 Map 模拟
- hash.ts 中 sha256 优先使用 Bun 原生 API（Bun.CryptoHasher），不引入额外依赖
