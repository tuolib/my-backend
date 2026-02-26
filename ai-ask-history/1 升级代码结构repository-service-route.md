# 重构计划：Route / Service / Repository 三层架构

## Context

当前项目的 `*.controller.ts` 文件同时承担路由、业务逻辑、DB/Redis 直接访问三种职责，且 `index.ts` 手动组装路由，无法扩展。本次重构目标：
- 引入 Repository 层，将数据访问与业务逻辑分离
- Route 层只处理 HTTP 请求/响应，不含业务逻辑
- 新增 `router.ts` 集中管理路由注册，`index.ts` 只负责初始化
- 顺带修正 HTTP 动词错误（POST 改 GET/PATCH/DELETE）

## 目标目录结构

```
src/
├── index.ts              [修改] 移除路由组装逻辑，调用 buildRouter()
├── router.ts             [新建] 统一路由注册中心
├── modules/
│   ├── login/
│   │   ├── login.route.ts        [新建] 替代 login.controller.ts
│   │   ├── login.service.ts      [修改] 移除 db/redis 直接访问
│   │   ├── login.repository.ts   [新建] Redis session + 委托 UserRepository
│   │   └── login.schema.ts       [不变]
│   └── users/
│       ├── user.route.ts         [新建] 替代 user.controller.ts，修正 HTTP 动词
│       ├── user.service.ts       [修改] 移除 Drizzle 直接访问
│       ├── user.repository.ts    [新建] 所有 Drizzle ORM 查询
│       └── user.schema.ts        [不变]
├── db/, lib/, middleware/, utils/ [全部不变]
```

## 实施顺序

### Step 1：新建 `src/modules/users/user.repository.ts`
从 `user.service.ts`（全部方法）和 `login.service.ts`（`findByEmail`、`updateLastLoginAt`）提取 Drizzle 查询。

```typescript
import { dbRead, dbWrite } from '@/db';
import { users } from '@/db/schema.ts';
import { eq } from 'drizzle-orm';

export type NewUserPayload = { email: string; passwordHash: string };
export type UpdateUserPayload = Partial<{ email: string; passwordHash: string; isActive: boolean }>;

export const UserRepository = {
  async findAll() {
    return await dbRead.select().from(users);
  },
  async findById(id: number) {
    const [user] = await dbRead.select().from(users).where(eq(users.id, id));
    return user;
  },
  async findByEmail(email: string) {
    const [user] = await dbRead.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  },
  async create(payload: NewUserPayload) {
    const [newUser] = await dbWrite.insert(users).values(payload).returning({
      id: users.id,
      email: users.email,
      createdAt: users.createdAt,
    });
    return newUser;
  },
  async update(id: number, payload: UpdateUserPayload) {
    const [updatedUser] = await dbWrite.update(users).set(payload).where(eq(users.id, id)).returning();
    return updatedUser;
  },
  async delete(id: number) {
    const [deletedUser] = await dbWrite.delete(users).where(eq(users.id, id)).returning();
    return deletedUser;
  },
  async updateLastLoginAt(id: number) {
    await dbWrite.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  },
};
```

### Step 2：新建 `src/modules/login/login.repository.ts`
封装 Redis session 操作，委托 UserRepository 处理 DB 查询。

```typescript
import { redisIns } from '@/lib/redis.ts';
import { UserRepository } from '@/modules/users/user.repository.ts';
import { REDIS_SESSION_PREFIX, REFRESH_TOKEN_EXPIRATION } from '@/middleware/auth-config.ts';

export const LoginRepository = {
  findUserByEmail: UserRepository.findByEmail,
  updateLastLoginAt: UserRepository.updateLastLoginAt,
  createUser: UserRepository.create,

  async setSession(userId: number | string, sid: string) {
    await redisIns.set(`${REDIS_SESSION_PREFIX}${userId}`, sid, { EX: REFRESH_TOKEN_EXPIRATION });
  },
  async getSession(userId: number | string): Promise<string | null> {
    return await redisIns.get(`${REDIS_SESSION_PREFIX}${userId}`);
  },
};
```

### Step 3：修改 `src/modules/users/user.service.ts`
移除所有 `dbRead`/`dbWrite` import，改调 `UserRepository`。新增更新时密码重新哈希的业务规则（原代码有安全漏洞：明文 password 可能被直接写入 DB）。

```typescript
import * as bcrypt from 'bcrypt';
import { UserRepository } from './user.repository.ts';
import type { CreateUserInput } from './user.schema.ts';

export const UserService = {
  async findAll() { return await UserRepository.findAll(); },
  async findById(id: number) { return await UserRepository.findById(id); },
  async create(data: CreateUserInput) {
    const passwordHash = await bcrypt.hash(data.password, 10);
    const { password, confirmPassword, ...userData } = data;
    return await UserRepository.create({ ...userData, passwordHash });
  },
  async update(id: number, data: Partial<CreateUserInput>) {
    const payload: Record<string, unknown> = { ...data };
    if (data.password) {
      payload.passwordHash = await bcrypt.hash(data.password, 10);
      delete payload.password;
      delete payload.confirmPassword;
    }
    return await UserRepository.update(id, payload as any);
  },
  async delete(id: number) { return await UserRepository.delete(id); },
};
```

### Step 4：修改 `src/modules/login/login.service.ts`
移除所有 `dbRead`/`dbWrite`/`redisIns` import，改调 `LoginRepository`。
同时修复原代码 bug：`refreshToken` 的 catch 块会把 `AuthenticationError` 吞掉重新包装，丢失原始消息。

关键改动：
- 删除 import：`dbRead, dbWrite`（`@/db`）、`redisIns`（`@/lib/redis.ts`）、`users`（`@/db/schema.ts`）
- 添加 import：`LoginRepository`
- 提取 `generateSid()` 工具函数（authenticate 和 refreshToken 共用）
- `refreshToken` catch 块改为：先判断 `instanceof AuthenticationError` 再决定是否重新包装

```typescript
import { sign, verify } from 'hono/jwt';
import * as bcrypt from 'bcrypt';
import { LoginRepository } from './login.repository.ts';
import type { LoginInput } from './login.schema.ts';
import { ACCESS_TOKEN_EXPIRATION, REFRESH_TOKEN_EXPIRATION, JWT_SECRET } from '@/middleware/auth-config.ts';

export class AuthenticationError extends Error {
  constructor(message: string) { super(message); this.name = 'AuthenticationError'; }
}

const generateSid = () =>
  Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

export class LoginService {
  async authenticate(input: LoginInput) {
    const user = await LoginRepository.findUserByEmail(input.email);
    if (!user) throw new AuthenticationError('邮箱或密码错误');
    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isPasswordValid) throw new AuthenticationError('邮箱或密码错误');
    if (!user.isActive) throw new AuthenticationError('账户已被禁用，请联系管理员');

    const sid = generateSid();
    await LoginRepository.setSession(user.id, sid);
    await LoginRepository.updateLastLoginAt(user.id);

    const accessToken = await sign({ sub: user.id, email: user.email, sid, exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRATION }, JWT_SECRET);
    const refreshToken = await sign({ sub: user.id, email: user.email, sid, exp: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_EXPIRATION }, JWT_SECRET);
    return { accessToken, refreshToken, user: { id: user.id, email: user.email } };
  }

  async refreshToken(oldToken: string) {
    try {
      const payload = await verify(oldToken, JWT_SECRET, 'HS256');
      const userId = payload.sub as string;
      const oldSid = payload.sid as string;
      const currentSid = await LoginRepository.getSession(userId);
      if (!currentSid || oldSid !== currentSid) throw new AuthenticationError('会话已失效，请重新登录');

      const newSid = generateSid();
      const newAccessToken = await sign({ sub: userId, email: payload.email, sid: newSid, exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRATION }, JWT_SECRET);
      const newRefreshToken = await sign({ sub: userId, email: payload.email, sid: newSid, exp: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_EXPIRATION }, JWT_SECRET);
      await LoginRepository.setSession(userId, newSid);
      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;  // 不吞掉原始错误
      throw new AuthenticationError('无效的刷新令牌或会话已过期');
    }
  }
}

export const loginService = new LoginService();
```

### Step 5：新建 `src/modules/users/user.route.ts`
HTTP 动词修正：POST→GET/PATCH/DELETE，id 从路径参数取。

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { UserService } from './user.service.ts';
import { updateUserSchema } from './user.schema.ts';
import { onZodError, ApiResult } from '@/utils/response.ts';

const userRoute = new Hono();

// GET /api/users  （原 POST /getAllUser）
userRoute.get('/', async (c) => {
  const data = await UserService.findAll();
  return ApiResult.success(c, data, '成功');
});

// PATCH /api/users/:id  （原 POST /update，id 从路径取）
userRoute.patch('/:id', zValidator('json', updateUserSchema.omit({ id: true }), onZodError), async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id)) return ApiResult.error(c, '无效的用户ID', 400);
  const data = c.req.valid('json');
  const user = await UserService.update(id, data);
  if (!user) return ApiResult.error(c, '用户不存在', 404);
  return ApiResult.success(c, user, '更新成功');
});

// DELETE /api/users/:id  （原 POST /delete，id 从路径取）
userRoute.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id)) return ApiResult.error(c, '无效的用户ID', 400);
  const user = await UserService.delete(id);
  if (!user) return ApiResult.error(c, '用户不存在', 404);
  return ApiResult.success(c, user, '删除成功');
});

export default userRoute;
```

### Step 6：新建 `src/modules/login/login.route.ts`
内容与原 `login.controller.ts` 基本一致，export 名称改为 `loginRoute`。
register 端点保留跨模块 `UserService.create()` 调用（见下方设计决策）。

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { loginService, AuthenticationError } from './login.service.ts';
import { loginBodySchema, refreshTokenBodySchema } from './login.schema.ts';
import { ApiResult, onZodError } from '@/utils/response.ts';
import { parseDbError } from '@/utils/db-error.ts';
import { createUserSchema } from '@/modules/users/user.schema.ts';
import { UserService } from '@/modules/users/user.service.ts';

const loginRoute = new Hono();

loginRoute.post('/login', zValidator('json', loginBodySchema, onZodError), async (c) => {
  try {
    const { accessToken, refreshToken, user } = await loginService.authenticate(c.req.valid('json'));
    return ApiResult.success(c, { accessToken, refreshToken, user });
  } catch (error) {
    if (error instanceof AuthenticationError) return ApiResult.error(c, error.message, 401);
    throw error;
  }
});

loginRoute.post('/refresh', zValidator('json', refreshTokenBodySchema, onZodError), async (c) => {
  try {
    const { refreshToken } = c.req.valid('json');
    const { accessToken, refreshToken: newRefreshToken } = await loginService.refreshToken(refreshToken);
    return ApiResult.success(c, { accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    if (error instanceof AuthenticationError) return ApiResult.error(c, error.message, 401);
    throw error;
  }
});

loginRoute.post('/register', zValidator('json', createUserSchema, onZodError), async (c) => {
  try {
    const data = await UserService.create(c.req.valid('json'));
    return ApiResult.success(c, data, '注册成功');
  } catch (e: any) {
    console.error('[Register Error]', e);
    const { errorCode } = parseDbError(e);
    if (errorCode === '23505') return ApiResult.error(c, '该邮箱已被注册', 409);
    return ApiResult.error(c, '服务器繁忙，请稍后再试', 500);
  }
});

export { loginRoute };
```

### Step 7：新建 `src/router.ts`

```typescript
import { Hono } from 'hono';
import { authMiddleware } from '@/middleware/auth.ts';
import { loginRoute } from '@/modules/login/login.route.ts';
import userRoute from '@/modules/users/user.route.ts';

export const buildRouter = (): Hono => {
  const router = new Hono();

  const publicApi = new Hono();
  publicApi.route('/account', loginRoute);

  const protectedApi = new Hono();
  protectedApi.use('*', authMiddleware);
  protectedApi.route('/users', userRoute);

  router.route('/api', publicApi);
  router.route('/api', protectedApi);

  return router;
};
```

### Step 8：修改 `src/index.ts`
移除路由组装逻辑，改调 `buildRouter()`。

关键改动（其余内容保持不变）：
- 删除 import：`loginController`（原 login.controller.ts）、`userApp`（原 user.controller.ts）、`authMiddleware`
- 添加 import：`buildRouter`（@/router.ts）
- 删除 `publicApi`/`protectedApi` 的构建代码（约 6 行）
- 替换为：`app.route('/', buildRouter());`

### Step 9：删除旧文件
- `src/modules/login/login.controller.ts`
- `src/modules/users/user.controller.ts`

## 设计决策：register 端点的跨模块 Service 调用

`login.route.ts` 的 `/register` 端点调用 `UserService.create()` 是合理设计：
- "创建用户"的业务逻辑（密码哈希、字段组装）归属 UserService
- login route 只是触发点，不重复实现
- 调用链：`login.route → UserService → UserRepository`，三层均完整

## HTTP 动词变更对照

| 原接口 | 新接口 | 说明 |
|--------|--------|------|
| `POST /api/users/getAllUser` | `GET /api/users` | 语义修正 |
| `POST /api/users/update` body `{id, ...}` | `PATCH /api/users/:id` body `{...}` | 语义修正，id 移至路径参数 |
| `POST /api/users/delete` body `{id}` | `DELETE /api/users/:id` | 语义修正，id 移至路径参数 |

## 不修改的文件

- `src/db/index.ts`, `src/db/schema.ts`, `src/db/migrate.ts`
- `src/lib/redis.ts`
- `src/middleware/auth.ts`, `src/middleware/auth-config.ts`
- `src/utils/response.ts`, `src/utils/db-error.ts`
- `src/modules/*/**.schema.ts`

## 验证方法

1. 启动服务：`bun run dev`，确认无 import 错误
2. 测试公开路由：`POST /api/account/login`、`POST /api/account/register`、`POST /api/account/refresh`
3. 测试受保护路由（带 Bearer token）：`GET /api/users`、`PATCH /api/users/1`、`DELETE /api/users/1`
4. 确认旧接口 `POST /api/users/getAllUser` 已不存在（返回 404）
5. 检查健康检查端点：`GET /healthz`、`GET /readyz`
