# Architecture Decision Record — 企业级高并发电商平台

> 本文档是所有开发阶段的**唯一架构真相来源（Single Source of Truth）**。  
> Claude Code CLI 每个新会话应首先阅读本文档中对应阶段的内容。

---

## 1. 系统全景

### 1.1 设计目标

| 维度 | 目标 | 实现手段 |
|------|------|----------|
| 高并发 | 单节点 10K+ RPS | Bun 高性能运行时 + 连接池 + Redis 缓存 |
| 高可用 | 服务独立部署、独立扩缩容 | 微服务拆分 + Docker + 健康检查 |
| 可演进 | 新业务域可快速接入 | Monorepo + 共享包 + 统一规范 |
| 开发效率 | 一人可维护全栈 | TypeScript 全栈 + 代码共享 + 自动化 |
| 安全 | 零信任、最小权限 | JWT + Caddy TLS + 服务间鉴权 |

### 1.2 架构拓扑

```
                          ┌──────────────┐
                          │    Caddy      │
                          │  (TLS终止)    │
                          │  :443 / :80   │
                          └──────┬───────┘
                                 │
                          ┌──────▼───────┐
                          │ API Gateway  │
                          │   (Hono)     │
                          │   :3000      │
                          └──┬───────┬───┘
                             │       │
                 ┌───────────▼─┐   ┌─▼───────────┐
                 │ User Service│   │Product Service│
                 │    :3001    │   │    :3002      │
                 └──────┬──────┘   └──────┬───────┘
                        │                 │
               ┌────────▼─────────────────▼────────┐
               │          PostgreSQL :5432          │
               │     (每个 service 独立 schema)      │
               └───────────────────────────────────┘
               ┌───────────────────────────────────┐
               │           Redis :6379              │
               │   缓存 / 会话 / 分布式锁 / 队列     │
               └───────────────────────────────────┘
```

### 1.3 技术选型理由

**Bun over Node.js：** 内置 TS 支持、更快的启动速度、原生 SQLite/测试框架、兼容 npm 生态。电商场景下 HTTP 吞吐量优势明显。

**Hono over Express/Fastify：** 零依赖、类型安全的中间件体系、原生支持 Zod validator、多运行时兼容（Bun/Deno/CF Workers），未来可无缝迁移至边缘部署。

**Drizzle ORM over Prisma/Kysely：** SQL-first 设计避免 ORM 抽象泄漏，零运行时开销（纯编译时类型推导），schema 可直接导出 Zod 类型，与 Hono 校验链天然集成。

**PostgreSQL over MySQL：** JSONB 支持灵活扩展字段（商品属性、用户偏好），内置全文搜索（减少 ES 依赖），更强的并发控制（MVCC），丰富的索引类型（GIN, GiST, BRIN）。

**Caddy over Nginx：** 自动 HTTPS（Let's Encrypt / ZeroSSL），配置极简（Caddyfile），内置负载均衡和健康检查，Go 编写易于扩展。

---

## 2. 服务边界定义

### 2.1 User Service（用户域）

**职责边界：** 用户身份全生命周期管理

| 能力 | 说明 |
|------|------|
| 注册 / 登录 | 邮箱+密码注册，JWT 签发 |
| 用户资料 CRUD | 昵称、头像、联系方式 |
| 地址管理 | 收货地址增删改查，默认地址 |
| 会话管理 | Token 刷新、登出（Redis 黑名单） |
| 密码安全 | Argon2 哈希、重置密码流程 |

**不负责：** 订单、支付、权限策略（RBAC 未来独立服务）

### 2.2 Product Service（商品域）

**职责边界：** 商品信息全生命周期管理

| 能力 | 说明 |
|------|------|
| 商品 CRUD | 标题、描述、价格、图片、属性 |
| 分类体系 | 多级分类树，商品-分类多对多 |
| SKU 管理 | 规格组合（颜色/尺码）、独立库存 |
| 搜索 | PostgreSQL 全文搜索 + 分类筛选 |
| 库存 | 库存扣减（Redis 预扣 + DB 最终一致） |

**不负责：** 定价策略、促销活动、购物车（未来独立服务）

### 2.3 API Gateway

**职责边界：** 唯一外部入口，横切关注点

| 能力 | 说明 |
|------|------|
| 路由转发 | `/api/v1/auth/*`, `/api/v1/user/*` → User Service |
|  | `/api/v1/product/*`, `/api/v1/category/*` → Product Service |
|  | `/api/v1/admin/*` → 对应 Service（按前缀二级分发） |
| 鉴权 | JWT 验证 + 用户上下文注入 |
| 限流 | 基于 IP / Token 的滑动窗口限流（Redis） |
| 请求追踪 | traceId 生成 & 向下游透传 |
| 日志 | 统一请求/响应日志 |
| CORS | 跨域策略管理 |

---

## 3. 数据库设计

### 3.1 Schema 隔离策略

每个 service 使用独立 PostgreSQL schema（非独立数据库），共享连接池但逻辑隔离：

```sql
CREATE SCHEMA IF NOT EXISTS user_service;
CREATE SCHEMA IF NOT EXISTS product_service;
```

### 3.2 公共字段约定

所有表必须包含：

```typescript
{
  id:         varchar(21).primaryKey(),    // nanoid
  createdAt:  timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt:  timestamp({ withTimezone: true }).defaultNow().notNull(),
}
```

### 3.3 User Service 表结构

```
┌─────────────────────────────────────┐
│              users                   │
├─────────────────────────────────────┤
│ id          VARCHAR(21)    PK        │
│ email       VARCHAR(255)   UNIQUE    │
│ password    VARCHAR(255)   NOT NULL  │  ← Argon2 hash
│ nickname    VARCHAR(50)              │
│ avatar_url  TEXT                     │
│ status      VARCHAR(20)    DEFAULT   │  ← active / suspended / deleted
│ last_login  TIMESTAMPTZ              │
│ created_at  TIMESTAMPTZ    NOT NULL  │
│ updated_at  TIMESTAMPTZ    NOT NULL  │
│ deleted_at  TIMESTAMPTZ              │  ← 软删除
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│          user_addresses              │
├─────────────────────────────────────┤
│ id          VARCHAR(21)    PK        │
│ user_id     VARCHAR(21)    FK→users  │
│ label       VARCHAR(50)              │  ← "家", "公司"
│ recipient   VARCHAR(100)   NOT NULL  │
│ phone       VARCHAR(20)    NOT NULL  │
│ province    VARCHAR(50)    NOT NULL  │
│ city        VARCHAR(50)    NOT NULL  │
│ district    VARCHAR(50)    NOT NULL  │
│ address     TEXT           NOT NULL  │
│ postal_code VARCHAR(10)              │
│ is_default  BOOLEAN        DEFAULT   │
│ created_at  TIMESTAMPTZ    NOT NULL  │
│ updated_at  TIMESTAMPTZ    NOT NULL  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│          refresh_tokens              │
├─────────────────────────────────────┤
│ id          VARCHAR(21)    PK        │
│ user_id     VARCHAR(21)    FK→users  │
│ token_hash  VARCHAR(255)   UNIQUE    │  ← SHA-256 of token
│ expires_at  TIMESTAMPTZ    NOT NULL  │
│ revoked_at  TIMESTAMPTZ              │
│ created_at  TIMESTAMPTZ    NOT NULL  │
└─────────────────────────────────────┘
```

### 3.4 Product Service 表结构

```
┌─────────────────────────────────────┐
│           categories                 │
├─────────────────────────────────────┤
│ id          VARCHAR(21)    PK        │
│ parent_id   VARCHAR(21)    FK→self   │  ← 多级分类
│ name        VARCHAR(100)   NOT NULL  │
│ slug        VARCHAR(100)   UNIQUE    │
│ sort_order  INTEGER        DEFAULT 0 │
│ created_at  TIMESTAMPTZ    NOT NULL  │
│ updated_at  TIMESTAMPTZ    NOT NULL  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│            products                  │
├─────────────────────────────────────┤
│ id          VARCHAR(21)    PK        │
│ title       VARCHAR(200)   NOT NULL  │
│ slug        VARCHAR(200)   UNIQUE    │
│ description TEXT                     │
│ status      VARCHAR(20)    DEFAULT   │  ← draft / active / archived
│ attributes  JSONB                    │  ← 灵活扩展字段
│ created_at  TIMESTAMPTZ    NOT NULL  │
│ updated_at  TIMESTAMPTZ    NOT NULL  │
│ deleted_at  TIMESTAMPTZ              │
└─────────────────────────────────────┘
  │
  │  多对多
  ▼
┌─────────────────────────────────────┐
│      product_categories              │
├─────────────────────────────────────┤
│ product_id  VARCHAR(21)    FK        │
│ category_id VARCHAR(21)    FK        │
│ PRIMARY KEY (product_id, category_id)│
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│          product_images              │
├─────────────────────────────────────┤
│ id          VARCHAR(21)    PK        │
│ product_id  VARCHAR(21)    FK        │
│ url         TEXT           NOT NULL  │
│ alt_text    VARCHAR(200)             │
│ sort_order  INTEGER        DEFAULT 0 │
│ created_at  TIMESTAMPTZ    NOT NULL  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│              skus                    │
├─────────────────────────────────────┤
│ id          VARCHAR(21)    PK        │
│ product_id  VARCHAR(21)    FK        │
│ sku_code    VARCHAR(50)    UNIQUE    │
│ price       DECIMAL(12,2)  NOT NULL  │
│ compare_price DECIMAL(12,2)          │  ← 划线价
│ stock       INTEGER        DEFAULT 0 │
│ attributes  JSONB                    │  ← {"color":"红","size":"XL"}
│ status      VARCHAR(20)    DEFAULT   │  ← active / inactive
│ created_at  TIMESTAMPTZ    NOT NULL  │
│ updated_at  TIMESTAMPTZ    NOT NULL  │
└─────────────────────────────────────┘
```

### 3.5 索引策略

```sql
-- User Service
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_addresses_user ON user_addresses(user_id);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- Product Service
CREATE INDEX idx_products_status ON products(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_slug ON products(slug);
CREATE INDEX idx_products_fulltext ON products USING GIN(to_tsvector('english', title || ' ' || coalesce(description, '')));
CREATE INDEX idx_skus_product ON skus(product_id);
CREATE INDEX idx_skus_code ON skus(sku_code);
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_slug ON categories(slug);
```

---

## 4. Redis 使用规范

### 4.1 Key 命名约定

```
{service}:{resource}:{id}:{sub}

示例：
user:session:{userId}              → JWT 黑名单
user:profile:{userId}              → 用户信息缓存
product:detail:{productId}         → 商品详情缓存
product:stock:{skuId}              → SKU 库存预扣
gateway:ratelimit:{ip}             → IP 限流计数器
gateway:ratelimit:{token}          → Token 限流计数器
```

### 4.2 TTL 策略

| Key 类型 | TTL | 说明 |
|----------|-----|------|
| session blacklist | = refresh token 剩余有效期 | 登出后阻止旧 token |
| user profile cache | 30 min | 低频变更 |
| product detail cache | 10 min | 中频变更 |
| stock counter | 无 TTL | 实时同步 |
| rate limit | 滑动窗口 60s | 自动过期 |

---

## 5. 认证 & 鉴权设计

### 5.1 JWT 双 Token 机制

```
Access Token:   短期（15 min），无状态验证
Refresh Token:  长期（7 days），存储在 DB + HttpOnly Cookie

流程：
1. 登录 → 签发 access + refresh token
2. 请求 → Gateway 用 access token 验证
3. 过期 → 客户端用 refresh token 换新 access token
4. 登出 → refresh token 写入 revoked_at + access token 加入 Redis 黑名单
```

### 5.2 JWT Payload

```typescript
{
  sub: string;      // userId
  email: string;
  iat: number;
  exp: number;
}
```

---

## 6. 错误码体系

### 6.1 HTTP 状态码映射

| 状态码 | 错误类 | 场景 |
|--------|--------|------|
| 400 | BadRequestError | 参数格式错误 |
| 401 | UnauthorizedError | 未登录 / Token 无效 |
| 403 | ForbiddenError | 无权限访问 |
| 404 | NotFoundError | 资源不存在 |
| 409 | ConflictError | 资源冲突（邮箱已注册） |
| 422 | ValidationError | 业务校验失败 |
| 429 | RateLimitError | 请求过于频繁 |
| 500 | InternalError | 系统内部错误 |

### 6.2 业务错误码

```typescript
enum ErrorCode {
  // User 域 (1xxx)
  USER_NOT_FOUND       = "USER_1001",
  USER_ALREADY_EXISTS  = "USER_1002",
  INVALID_CREDENTIALS  = "USER_1003",
  TOKEN_EXPIRED        = "USER_1004",
  TOKEN_REVOKED        = "USER_1005",
  PASSWORD_TOO_WEAK    = "USER_1006",
  EMAIL_NOT_VERIFIED   = "USER_1007",

  // Product 域 (2xxx)
  PRODUCT_NOT_FOUND    = "PRODUCT_2001",
  SKU_NOT_FOUND        = "PRODUCT_2002",
  STOCK_INSUFFICIENT   = "PRODUCT_2003",
  CATEGORY_NOT_FOUND   = "PRODUCT_2004",
  DUPLICATE_SKU_CODE   = "PRODUCT_2005",
  INVALID_PRICE        = "PRODUCT_2006",

  // Gateway (9xxx)
  RATE_LIMITED         = "GATEWAY_9001",
  SERVICE_UNAVAILABLE  = "GATEWAY_9002",
}
```

---

## 7. API 路由规范

### 7.1 全 POST 约定

所有接口统一使用 `POST` 方法，参数通过 JSON Body 传递（包括查询、分页）。  
路由路径通过动词后缀区分操作类型，资源 ID 也放入 Body 而非 URL 路径。

**设计理由：**
- 统一请求格式，前端封装更简单（一个 `post()` 函数搞定）
- Body 传参无 URL 长度限制，适合复杂查询条件
- 便于网关统一做日志、鉴权、限流（所有请求结构一致）
- 避免 GET 请求被缓存导致的数据一致性问题

**路由命名规则：**
```
POST /api/v1/{domain}/{action}

动作后缀约定：
  /list     → 列表查询（分页）
  /detail   → 单条详情
  /create   → 创建
  /update   → 更新
  /delete   → 删除（软删除）
```

### 7.2 分页参数

```
POST /api/v1/product/list

Body:
{
  "page": 1,
  "pageSize": 20,
  "sort": "createdAt",
  "order": "desc",
  "filters": {
    "status": "active",
    "categoryId": "abc123"
  }
}

响应：
{
  success: true,
  data: {
    items: [...],
    pagination: {
      page: 1,
      pageSize: 20,
      total: 156,
      totalPages: 8
    }
  },
  traceId: "..."
}
```

### 7.3 路由表

```
# ──── 公开路由（无需认证）────
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh

POST   /api/v1/product/list
POST   /api/v1/product/detail            # Body: { "id": "xxx" }
POST   /api/v1/product/sku/list          # Body: { "productId": "xxx" }
POST   /api/v1/product/search            # Body: { "keyword": "...", "page": 1, ... }

POST   /api/v1/category/list
POST   /api/v1/category/detail           # Body: { "id": "xxx" }
POST   /api/v1/category/tree             # 返回完整分类树

# ──── 需要认证 ────
POST   /api/v1/auth/logout

POST   /api/v1/user/profile              # 获取当前用户信息
POST   /api/v1/user/update               # Body: { "nickname": "...", ... }

POST   /api/v1/user/address/list
POST   /api/v1/user/address/create
POST   /api/v1/user/address/update       # Body: { "id": "xxx", ... }
POST   /api/v1/user/address/delete       # Body: { "id": "xxx" }

# ──── 管理端（需要 admin 角色 — 未来实现）────
POST   /api/v1/admin/product/create
POST   /api/v1/admin/product/update      # Body: { "id": "xxx", ... }
POST   /api/v1/admin/product/delete      # Body: { "id": "xxx" }
POST   /api/v1/admin/product/sku/create  # Body: { "productId": "xxx", ... }
POST   /api/v1/admin/product/sku/update  # Body: { "skuId": "xxx", ... }
POST   /api/v1/admin/category/create
POST   /api/v1/admin/category/update     # Body: { "id": "xxx", ... }
```

---

## 8. 分阶段开发路线图

> **每个阶段 = 一个独立的 Claude Code CLI 会话**  
> 每个阶段标注了：目标产出、验收标准、预估工作量

---

### Phase 0: 架构文档 ✅

**状态：已完成（本文档即产出）**

---

### Phase 1: Monorepo 骨架 + 基础设施

**目标：** 项目能 `bun install` 且 `docker compose up` 一键启动全部基础设施

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 1 的描述。
搭建 monorepo 骨架，包括：
1. 根 package.json（bun workspace 配置）
2. 根 tsconfig.json + 各包的 tsconfig 继承链
3. packages/shared 和 packages/database 的空骨架（package.json + 空 index.ts）
4. apps/api-gateway 空骨架
5. services/user-service 和 services/product-service 空骨架
6. infra/docker/docker-compose.yml（PostgreSQL 16 + Redis 7）
7. infra/caddy/Caddyfile（反向代理到 api-gateway:3000）
8. .env.example 模板
9. 根目录 Makefile 或 scripts（dev / build / test / docker-up / docker-down）
不写任何业务代码。
```

**产出物：**
- `package.json`（root）— workspace 配置
- `tsconfig.json`（root）+ 各包 `tsconfig.json`
- 所有包的 `package.json` + 空入口文件
- `docker-compose.yml` — PG + Redis + Caddy
- `Caddyfile`
- `.env.example`
- `Makefile` 或 `package.json scripts`

**验收标准：**
- [ ] `bun install` 无错误
- [ ] `docker compose up -d` 启动 PG + Redis + Caddy
- [ ] `docker compose ps` 全部 healthy
- [ ] 各包的 `bun run build` 不报错（即使是空包）

**预估：** 1 个会话

---

### Phase 2: packages/shared — 通用基础能力

**目标：** 错误体系、响应格式、核心中间件全部就绪，可被其他包引用

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 2 + 错误码体系 + 响应格式。
实现 packages/shared，按以下顺序：
1. config/ — 环境变量加载 & Zod schema 校验
2. errors/ — AppError 基类 + 所有 HTTP 错误子类 + 业务错误码枚举
3. response/ — 统一 success() / error() 响应构建器
4. types/ — 全局 TS 类型（Pagination, SortOrder 等）
5. utils/ — nanoid ID 生成器 + 时间工具
6. middleware/ — error-handler, request-id, logger, validate(Zod), auth(预留)
7. index.ts — 统一导出
每个模块写对应的 .test.ts 单元测试。
```

**产出物：**
- `packages/shared/src/` 完整实现
- 每个模块的 `*.test.ts`

**验收标准：**
- [ ] `bun test` 全部通过
- [ ] 从其他包 `import { AppError, NotFoundError, success, validate } from "@repo/shared"` 无类型错误
- [ ] error-handler 中间件能捕获所有 AppError 子类并转为统一响应
- [ ] config 模块缺少必要环境变量时启动即报错

**预估：** 1 个会话

---

### Phase 3: packages/database — 数据库层

**目标：** Drizzle schema 定义完成，迁移可执行，连接池就绪

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 3 + 数据库设计章节。
实现 packages/database：
1. client.ts — Drizzle + PostgreSQL 连接池（使用 @repo/shared 的 config）
2. redis.ts — Redis 连接封装（ioredis）
3. schema/users.ts — users, user_addresses, refresh_tokens 表
4. schema/products.ts — products, categories, product_categories, product_images, skus 表
5. schema/index.ts — 统一导出所有 schema
6. migrate.ts — 迁移执行入口（可 `bun run migrate` 执行）
7. seed.ts — 开发种子数据（可选）
8. index.ts — 导出 db, redis, schema, types
确保所有索引按 architecture.md 定义。
```

**产出物：**
- `packages/database/src/` 完整实现
- Drizzle 迁移文件

**验收标准：**
- [ ] `bun run migrate` 在本地 PG 执行成功
- [ ] 所有表和索引与 architecture.md 一致
- [ ] `db.select().from(users)` 类型正确
- [ ] Redis 连接 ping 成功

**预估：** 1 个会话

---

### Phase 4: services/user-service — 用户域

**目标：** 完整的用户注册/登录/JWT/资料管理 API

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 4 + User Service 边界定义。
实现 services/user-service：
1. Hono app 实例 + 路由挂载
2. auth 路由：register, login, refresh, logout
3. user 路由：GET /me, PUT /me
4. address 路由：CRUD /me/addresses
5. 业务逻辑层（service 层，与路由分离）
6. JWT 签发/验证工具（access + refresh token）
7. 密码哈希（Argon2）
8. 使用 @repo/shared 中间件 + @repo/database
9. 集成测试（模拟 HTTP 请求测试所有路由）
```

**产出物：**
- `services/user-service/src/` 完整实现
- 路由、服务、类型分层
- 集成测试

**验收标准：**
- [ ] 注册 → 登录 → 获取 /me → 更新资料 → 登出 全流程跑通
- [ ] refresh token 可换新 access token
- [ ] 重复邮箱注册返回 409 + USER_1002
- [ ] 错误密码登录返回 401 + USER_1003
- [ ] 未认证请求返回 401
- [ ] 所有测试通过

**预估：** 1-2 个会话

---

### Phase 5: services/product-service — 商品域

**目标：** 完整的商品 CRUD、分类管理、SKU 管理、搜索

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 5 + Product Service 边界定义。
实现 services/product-service：
1. Hono app 实例 + 路由挂载
2. product 路由：CRUD + 列表分页 + 全文搜索
3. category 路由：CRUD + 树形结构查询
4. sku 路由：CRUD（挂在 product 下）
5. 业务逻辑层（service 层）
6. 库存管理：Redis 预扣 + DB 最终一致
7. 使用 @repo/shared + @repo/database
8. 集成测试
```

**产出物：**
- `services/product-service/src/` 完整实现
- 集成测试

**验收标准：**
- [ ] 商品 CRUD 全流程
- [ ] 分页 + 排序 + 全文搜索
- [ ] 分类树查询
- [ ] SKU 创建 + 库存扣减
- [ ] 库存不足返回 422 + PRODUCT_2003
- [ ] 所有测试通过

**预估：** 1-2 个会话

---

### Phase 6: apps/api-gateway — 网关整合

**目标：** 唯一外部入口，路由转发 + 认证 + 限流 + 日志

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 6 + API Gateway 定义。
实现 apps/api-gateway：
1. Hono app 主入口
2. 中间件链：request-id → logger → cors → rate-limit → auth → error-handler
3. 路由转发：/api/v1/auth/* 和 /api/v1/user/* → user-service:3001
4. 路由转发：/api/v1/product/* 和 /api/v1/category/* → product-service:3002
5. 路由转发：/api/v1/admin/* → 按二级前缀分发到对应 service
5. 限流实现：Redis 滑动窗口（按 IP + Token 双维度）
6. 健康检查：GET /health
7. 端到端测试：启动全部服务，测试完整请求链路
```

**产出物：**
- `apps/api-gateway/src/` 完整实现
- 端到端测试脚本

**验收标准：**
- [ ] 所有路由通过 gateway 访问正常
- [ ] 未认证请求被 auth 中间件拦截
- [ ] 公开路由（login/register/商品列表）可匿名访问
- [ ] 限流触发后返回 429
- [ ] traceId 贯穿全链路
- [ ] /health 返回各下游服务状态

**预估：** 1 个会话

---

### Phase 7: 部署 & 联调

**目标：** Docker 多阶段构建 + 完整部署配置 + 全链路验证

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 7。
完成部署相关配置：
1. 每个 service/app 的 Dockerfile（多阶段构建，使用 Bun）
2. 更新 docker-compose.yml 加入所有应用服务
3. 完善 Caddyfile 路由规则
4. 健康检查配置（Docker healthcheck + Caddy health）
5. 日志收集方案（stdout → docker logs）
6. 编写部署文档 docs/deployment.md
7. 全链路冒烟测试脚本
```

**产出物：**
- 各服务 Dockerfile
- 完整 `docker-compose.yml`（infra + apps + services）
- 完善的 Caddyfile
- `docs/deployment.md`
- 冒烟测试脚本

**验收标准：**
- [ ] `docker compose up` 一键启动全部服务
- [ ] 通过 Caddy（:443 或 :80）访问所有 API
- [ ] 冒烟测试脚本全部通过
- [ ] 各服务日志可通过 `docker compose logs` 查看

**预估：** 1 个会话

---

### Phase 8+: 未来演进（备忘）

以下为后续可扩展方向，不在当前开发范围内：

- **Order Service** — 购物车、订单、支付集成
- **Search Service** — 独立搜索服务（Meilisearch / Typesense）
- **Notification Service** — 邮件、短信、站内信
- **File Service** — 图片上传、CDN 集成（S3 / R2）
- **Admin Dashboard** — 管理后台（React / Vue）
- **RBAC** — 角色权限管理
- **消息队列** — Redis Streams / BullMQ 异步任务
- **监控** — Prometheus + Grafana
- **CI/CD** — GitHub Actions 自动化

---

## 9. 服务间通信

### 当前方案（Phase 1-7）

直接 HTTP 调用，Gateway 作为唯一入口点。服务间通信通过内部 Docker 网络。

```typescript
// Gateway 转发示例
const resp = await fetch(`http://user-service:3001/api/v1/users/me`, {
  headers: { "x-trace-id": traceId, "x-user-id": userId }
});
```

### 未来演进

- 服务发现（Consul / 内置注册表）
- 异步通信（Redis Streams 事件总线）
- gRPC（性能敏感的服务间调用）

---

## 10. 安全清单

| 项目 | 实现 | 阶段 |
|------|------|------|
| HTTPS 终止 | Caddy 自动证书 | Phase 1 |
| 密码哈希 | Argon2id | Phase 4 |
| JWT 短期 Token | 15 min + refresh | Phase 4 |
| CORS 白名单 | Gateway 中间件 | Phase 6 |
| 限流 | Redis 滑动窗口 | Phase 6 |
| SQL 注入防护 | Drizzle 参数化查询 | Phase 3 |
| XSS 防护 | Hono secure headers | Phase 6 |
| 环境变量隔离 | .env 不入仓库 | Phase 1 |
| 请求追踪 | traceId 全链路 | Phase 2 |
