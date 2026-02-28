# Phase 4: services/user-service — 用户与认证域（完整实现）

## 前置条件
Phase 3 已完成。请先确认：
- `bun run seed` 已执行，DB 中有测试用户数据
- `import { db, redis } from "@repo/database"` 正常
- `import { AppError, hashPassword, verifyPassword, signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken, createAuthMiddleware, validate, errorHandler, requestId, logger, success, error, ErrorCode, generateId, sha256 } from "@repo/shared"` 全部正常
- Docker 中 PostgreSQL 和 Redis 正在运行

## 本次任务
完整实现 services/user-service（:3001），包括认证、用户资料、地址管理、内部接口。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `CLAUDE.md`（Service 分层结构 + API 设计 + 响应格式）
- `docs/architecture.md` 第 2.1 节（User Service 边界）+ 第 5 章（JWT 双 Token）+ 第 6 章（错误码）+ 第 7.3 节（路由表中 auth/* + user/* 部分）

### 第二步：审计现有代码
扫描 `services/user-service/src/` 现有文件，列出哪些已实现、哪些缺失。
对照架构规范检查分层结构是否正确。

### 第三步：安装依赖
```bash
cd services/user-service
bun add hono @repo/shared @repo/database zod
bun add -d typescript @types/bun
```

### 第四步：搭建分层结构

目标目录结构：
```
services/user-service/src/
├── index.ts                  # Hono app 入口 + 启动
├── routes/
│   ├── auth.ts               # /api/v1/auth/* 路由
│   ├── user.ts               # /api/v1/user/* 路由
│   ├── address.ts            # /api/v1/user/address/* 路由
│   └── internal.ts           # /internal/user/* 内部路由
├── services/
│   ├── auth.service.ts       # 认证业务逻辑
│   ├── user.service.ts       # 用户资料业务逻辑
│   └── address.service.ts    # 地址业务逻辑
├── repositories/
│   ├── user.repo.ts          # users 表数据访问
│   ├── address.repo.ts       # user_addresses 表数据访问
│   └── token.repo.ts         # refresh_tokens 表数据访问
├── schemas/                  # Zod 校验 schema（请求参数）
│   ├── auth.schema.ts
│   ├── user.schema.ts
│   └── address.schema.ts
└── types/
    └── index.ts              # 本服务 TS 类型
```

### 第五步：实现 Repository 层（数据访问）

**5a. `repositories/user.repo.ts`**
```typescript
// 所有操作使用 @repo/database 的 db 和 users schema

findByEmail(email: string): Promise<User | null>
findById(id: string): Promise<User | null>
findByIds(ids: string[]): Promise<User[]>           // 内部批量查询用
create(data: NewUser): Promise<User>
updateById(id: string, data: Partial<User>): Promise<User | null>
updateLastLogin(id: string): Promise<void>
```

**5b. `repositories/address.repo.ts`**
```typescript
findByUserId(userId: string): Promise<UserAddress[]>
findById(id: string): Promise<UserAddress | null>
create(data: NewUserAddress): Promise<UserAddress>
updateById(id: string, data: Partial<UserAddress>): Promise<UserAddress | null>
deleteById(id: string): Promise<void>
clearDefault(userId: string): Promise<void>          // 设新默认前先清除旧默认
countByUserId(userId: string): Promise<number>       // 地址数量上限检查
```

**5c. `repositories/token.repo.ts`**
```typescript
create(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<RefreshToken>
findByHash(tokenHash: string): Promise<RefreshToken | null>
revoke(id: string): Promise<void>                    // 设置 revoked_at
revokeAllByUser(userId: string): Promise<void>       // 登出时撤销该用户全部 refresh token
```

### 第六步：实现 Service 层（业务逻辑）

**6a. `services/auth.service.ts`**

```typescript
register(input: RegisterInput): Promise<{ user: UserProfile; accessToken: string; refreshToken: string }>
  // 1. 邮箱查重 → 存在则抛出 ConflictError(USER_ALREADY_EXISTS)
  // 2. hashPassword(input.password)
  // 3. userRepo.create({ id: generateId(), email, password: hash, nickname, status: "active" })
  // 4. 签发 access + refresh token
  // 5. 存储 refresh token hash 到 DB
  // 6. 返回用户信息（不含密码）+ 双 token

login(input: LoginInput): Promise<{ user: UserProfile; accessToken: string; refreshToken: string }>
  // 1. 邮箱查询用户 → 不存在则抛出 UnauthorizedError(INVALID_CREDENTIALS)
  // 2. verifyPassword → 不匹配则抛出 UnauthorizedError(INVALID_CREDENTIALS)
  //    注意：邮箱不存在和密码错误返回同一错误，防止邮箱枚举
  // 3. 检查用户状态 → suspended 或 deleted 则抛出 ForbiddenError
  // 4. 签发 access + refresh token
  // 5. 存储 refresh token hash 到 DB
  // 6. 更新 last_login
  // 7. 返回用户信息 + 双 token

refresh(refreshTokenStr: string): Promise<{ accessToken: string; refreshToken: string }>
  // 1. verifyRefreshToken(refreshTokenStr) → 解析 payload
  // 2. sha256(refreshTokenStr) → 查 DB 中的 refresh_tokens
  // 3. 不存在或已撤销 → 抛出 UnauthorizedError(TOKEN_REVOKED)
  // 4. 已过期 → 抛出 UnauthorizedError(TOKEN_EXPIRED)
  // 5. 撤销旧 refresh token
  // 6. 签发新 access + refresh token（Token Rotation）
  // 7. 存储新 refresh token hash
  // 8. 返回新双 token

logout(userId: string, tokenJti: string, refreshTokenStr?: string): Promise<void>
  // 1. 将当前 access token 的 JTI 加入 Redis 黑名单
  //    SET user:session:blacklist:{jti} 1 EX {access token 剩余秒数，默认900}
  // 2. 如果提供了 refreshToken：sha256 → 查 DB → 撤销
  // 3. 可选：revokeAllByUser(userId) 全量撤销
```

**6b. `services/user.service.ts`**
```typescript
getProfile(userId: string): Promise<UserProfile>
  // 查用户 → 不存在抛 NotFoundError(USER_NOT_FOUND)
  // 返回不含密码的用户信息

updateProfile(userId: string, input: UpdateUserInput): Promise<UserProfile>
  // 更新允许的字段：nickname, avatar_url, phone
  // 设置 updated_at = now()
  // 返回更新后的用户信息
```

**6c. `services/address.service.ts`**
```typescript
list(userId: string): Promise<UserAddress[]>

create(userId: string, input: CreateAddressInput): Promise<UserAddress>
  // 检查地址数量上限（最多 20 个）→ 超出抛 ValidationError(ADDRESS_LIMIT)
  // 如果 is_default = true → 先清除其他默认地址
  // 如果是第一个地址 → 自动设为默认

update(userId: string, addressId: string, input: UpdateAddressInput): Promise<UserAddress>
  // 查地址 → 不存在或不属于该用户 → NotFoundError
  // 如果设为默认 → 先清除其他默认
  // 更新字段

delete(userId: string, addressId: string): Promise<void>
  // 查地址 → 不存在或不属于该用户 → NotFoundError
  // 如果删的是默认地址 → 自动将最新的另一个地址设为默认
  // 删除
```

### 第七步：实现 Zod 校验 Schema

**`schemas/auth.schema.ts`**
```typescript
registerSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(8, "密码至少 8 位").max(100),
  nickname: z.string().min(1).max(50).optional(),
});

loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
```

**`schemas/user.schema.ts`**
```typescript
updateUserSchema = z.object({
  nickname: z.string().min(1).max(50).optional(),
  avatarUrl: z.string().url().optional(),
  phone: z.string().max(20).optional(),
});
```

**`schemas/address.schema.ts`**
```typescript
createAddressSchema = z.object({
  label: z.string().max(50).optional(),
  recipient: z.string().min(1).max(100),
  phone: z.string().min(1).max(20),
  province: z.string().min(1).max(50),
  city: z.string().min(1).max(50),
  district: z.string().min(1).max(50),
  address: z.string().min(1),
  postalCode: z.string().max(10).optional(),
  isDefault: z.boolean().optional().default(false),
});

updateAddressSchema = z.object({
  id: z.string().min(1),
  ...createAddressSchema 的所有字段改为 optional
});

deleteAddressSchema = z.object({
  id: z.string().min(1),
});
```

### 第八步：实现路由层

路由层职责：参数校验 → 调用 service → 构建响应。不含业务逻辑。

**8a. `routes/auth.ts`**
```typescript
const auth = new Hono();

// POST /api/v1/auth/register — 公开
auth.post("/register", validate(registerSchema), async (c) => {
  const input = c.get("validated");
  const result = await authService.register(input);
  return c.json(success(result));
});

// POST /api/v1/auth/login — 公开
auth.post("/login", validate(loginSchema), async (c) => { ... });

// POST /api/v1/auth/refresh — 公开
auth.post("/refresh", validate(refreshSchema), async (c) => { ... });

// POST /api/v1/auth/logout — 需要认证（auth 中间件挂在这个路由上）
auth.post("/logout", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const tokenJti = c.get("tokenJti");
  const body = await c.req.json().catch(() => ({}));
  await authService.logout(userId, tokenJti, body.refreshToken);
  return c.json(success(null, "登出成功"));
});
```

**8b. `routes/user.ts`** — 全部需要认证
```typescript
const user = new Hono();
user.use("/*", authMiddleware);

// POST /api/v1/user/profile
user.post("/profile", async (c) => { ... });

// POST /api/v1/user/update
user.post("/update", validate(updateUserSchema), async (c) => { ... });
```

**8c. `routes/address.ts`** — 全部需要认证
```typescript
const address = new Hono();
address.use("/*", authMiddleware);

// POST /api/v1/user/address/list
// POST /api/v1/user/address/create
// POST /api/v1/user/address/update
// POST /api/v1/user/address/delete
```

**8d. `routes/internal.ts`** — 内部接口（服务间调用）
```typescript
const internal = new Hono();
// 不挂 authMiddleware，但可以检查 x-internal-token

// POST /internal/user/detail — 根据 userId 获取用户信息
internal.post("/detail", async (c) => {
  const { id } = await c.req.json();
  const user = await userService.getProfile(id);
  return c.json(success(user));
});

// POST /internal/user/batch — 批量获取用户信息
internal.post("/batch", async (c) => {
  const { ids } = await c.req.json();
  const users = await userRepo.findByIds(ids);
  return c.json(success(users));
});
```

### 第九步：组装 App 入口

**`src/index.ts`**
```typescript
import { Hono } from "hono";
import { errorHandler, requestId, logger } from "@repo/shared";
import { redis } from "@repo/database";
import { createAuthMiddleware } from "@repo/shared";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/user";
import addressRoutes from "./routes/address";
import internalRoutes from "./routes/internal";

const app = new Hono();

// 全局中间件
app.use("*", requestId);
app.use("*", logger);
app.onError(errorHandler);

// 创建 auth 中间件实例（需要 Redis）
export const authMiddleware = createAuthMiddleware(redis);

// 挂载路由
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/user", userRoutes);
app.route("/api/v1/user/address", addressRoutes);
app.route("/internal/user", internalRoutes);

// 健康检查
app.post("/health", (c) => c.json({ status: "ok", service: "user-service" }));

export default {
  port: Number(process.env.USER_SERVICE_PORT) || 3001,
  fetch: app.fetch,
};
```

### 第十步：编写集成测试

**`src/__tests__/auth.test.ts`**
```
使用 Hono 的 app.request() 或 Bun 的 fetch 测试

测试用例（按顺序执行，前序结果传递给后续）：
1. 注册成功 → 返回 200 + user + accessToken + refreshToken
2. 重复邮箱注册 → 返回 409 + USER_1002
3. 登录成功 → 返回 200 + 双 token
4. 登录密码错误 → 返回 401 + INVALID_CREDENTIALS
5. 登录邮箱不存在 → 返回 401 + INVALID_CREDENTIALS（同上，不泄露信息）
6. refresh token 换新 → 返回 200 + 新双 token
7. 旧 refresh token 再用 → 返回 401（已被 rotation 撤销）
8. 用 access token 访问 /user/profile → 返回 200 + 用户信息
9. 登出 → 返回 200
10. 登出后用旧 access token 访问 → 返回 401（JTI 黑名单生效）
```

**`src/__tests__/user.test.ts`**
```
前置：先注册+登录获取 token

1. 获取 profile → 返回用户信息（不含 password）
2. 更新 nickname → 返回更新后的信息
3. 更新非法字段 → 忽略（不报错）
```

**`src/__tests__/address.test.ts`**
```
前置：先注册+登录获取 token

1. 地址列表（空）→ 返回 []
2. 创建地址 A（is_default: true）→ 成功
3. 创建地址 B → 成功，A 仍为默认
4. 地址列表 → 返回 2 条
5. 更新 B 设为默认 → A 不再是默认
6. 删除 B（默认地址）→ A 自动变为默认
7. 创建到 20 个地址上限 → 第 21 个返回 422 + ADDRESS_LIMIT
```

**`src/__tests__/internal.test.ts`**
```
1. /internal/user/detail → 返回用户信息
2. /internal/user/batch → 批量返回
3. 不存在的用户 → 返回 404
```

### 第十一步：验证
```bash
# 确保 Docker 运行 + 种子数据已加载
docker compose up -d

cd services/user-service
bun test

# 手动全流程验证（启动服务后 curl 测试）
bun run src/index.ts &
sleep 1

# 注册
curl -s -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123","nickname":"测试用户"}' | jq .

# 登录
curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}' | jq .

# 用返回的 accessToken 获取 profile
curl -s -X POST http://localhost:3001/api/v1/user/profile \
  -H "Authorization: Bearer <accessToken>" | jq .

kill %1  # 停止服务
```

### 第十二步：输出报告
- 文件清单 + 目录树
- 全部测试结果
- API 路由列表（含 curl 示例）
- Phase 4 完成确认 ✅
- Phase 5 预告：services/product-service（商品/分类/SKU/库存/搜索）

## 重要约束
- 路由层不含业务逻辑，仅做：参数校验 → 调 service → 构建响应
- Service 层不直接操作 DB，通过 repository 访问
- 密码字段永远不出现在 API 响应中（所有返回 user 的地方排除 password）
- 登录时邮箱不存在和密码错误返回同一错误码（INVALID_CREDENTIALS），防止邮箱枚举攻击
- Refresh Token Rotation：每次刷新后旧 token 立即失效
- 响应格式严格遵循：{ code, success, data, message, meta, traceId }
- 地址上限 20 个，超出抛 ADDRESS_LIMIT
- 删除默认地址后自动将最近的另一个设为默认
