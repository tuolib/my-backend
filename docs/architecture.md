# Architecture Decision Record — 企业级高并发电商平台

> 本文档是所有开发阶段的**唯一架构真相来源（Single Source of Truth）**。  
> Claude Code CLI 每个新会话应首先阅读本文档中对应阶段的内容。

---

## 1. 系统全景

### 1.1 设计目标

| 维度 | 目标 | 实现手段 |
|------|------|----------|
| 高并发 | 单节点 10K+ RPS | Bun 高性能运行时 + 连接池 + 多级缓存 |
| 高可用 | 服务独立部署、独立扩缩容 | 微服务拆分 + Docker + 健康检查 |
| 数据一致 | 库存零超卖、订单状态机严格 | Redis 预扣 + PG 事务 + 乐观锁 + Lua 脚本 |
| 可演进 | 新业务域可快速接入 | Monorepo + 共享包 + 统一规范 |
| 开发效率 | 一人可维护全栈 | TypeScript 全栈 + 代码共享 + 自动化 |
| 安全 | 零信任、最小权限 | JWT + Caddy TLS + 服务间鉴权 + 幂等设计 |

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
                              └──┬──┬──┬──┬──┘
                                 │  │  │  │
              ┌──────────────────┘  │  │  └──────────────────┐
              │          ┌─────────┘  └─────────┐           │
              ▼          ▼                      ▼           ▼
        ┌──────────┐ ┌──────────┐       ┌──────────┐ ┌──────────┐
        │  User    │ │ Product  │       │  Cart    │ │  Order   │
        │ Service  │ │ Service  │       │ Service  │ │ Service  │
        │  :3001   │ │  :3002   │       │  :3003   │ │  :3004   │
        └────┬─────┘ └────┬─────┘       └────┬─────┘ └────┬─────┘
             │            │                  │            │
    ┌────────▼────────────▼──────────────────▼────────────▼────────┐
    │                    PostgreSQL :5432                          │
    │       user_service | product_service | order_service         │
    │                  (schema 级隔离)                              │
    └─────────────────────────────────────────────────────────────┘
    ┌─────────────────────────────────────────────────────────────┐
    │                      Redis :6379                            │
    │  购物车 | 库存预扣 | 会话 | 缓存 | 分布式锁 | 限流 | 事件总线  │
    └─────────────────────────────────────────────────────────────┘
```

### 1.3 技术选型理由

**Bun over Node.js：** 内置 TS 支持、更快的启动速度、原生 SQLite/测试框架、兼容 npm 生态。电商场景下 HTTP 吞吐量优势明显。

**Hono over Express/Fastify：** 零依赖、类型安全的中间件体系、原生支持 Zod validator、多运行时兼容（Bun/Deno/CF Workers），未来可无缝迁移至边缘部署。

**Drizzle ORM over Prisma/Kysely：** SQL-first 设计避免 ORM 抽象泄漏，零运行时开销（纯编译时类型推导），schema 可直接导出 Zod 类型，与 Hono 校验链天然集成。

**PostgreSQL over MySQL：** JSONB 支持灵活扩展字段（商品属性、用户偏好），内置全文搜索（减少 ES 依赖），更强的并发控制（MVCC），丰富的索引类型（GIN, GiST, BRIN）。`SELECT ... FOR UPDATE` + Advisory Lock 提供行级锁与应用级锁能力。

**Caddy over Nginx：** 自动 HTTPS（Let's Encrypt / ZeroSSL），配置极简（Caddyfile），内置负载均衡和健康检查，Go 编写易于扩展。

**Redis 作为多功能基础设施：** 购物车存储（Hash）、库存预扣（Lua 原子操作）、分布式锁（Redlock 模式）、会话黑名单、API 限流、服务间事件总线（Streams）。一个组件覆盖多个基础设施需求，减少运维复杂度。

---

## 2. 服务边界定义

### 2.1 User Service（用户域）— :3001

**职责边界：** 用户身份全生命周期管理

| 能力 | 说明 |
|------|------|
| 注册 / 登录 | 邮箱+密码注册，JWT 签发 |
| 用户资料 CRUD | 昵称、头像、联系方式 |
| 地址管理 | 收货地址增删改查，默认地址 |
| 会话管理 | Token 刷新、登出（Redis 黑名单） |
| 密码安全 | Argon2 哈希、重置密码流程 |

**不负责：** 订单、支付、购物车、权限策略

### 2.2 Product Service（商品域）— :3002

**职责边界：** 商品信息与库存全生命周期管理

| 能力 | 说明 |
|------|------|
| 商品 CRUD | 标题、描述、价格、图片、属性 |
| 分类体系 | 多级分类树，商品-分类多对多 |
| SKU 管理 | 规格组合（颜色/尺码）、独立定价 |
| 库存管理 | Redis 预扣 + DB 最终一致 + 乐观锁 |
| 搜索 | PostgreSQL 全文搜索 + 分类筛选 + Redis 热门缓存 |

**不负责：** 购物车、订单、定价策略、促销活动

### 2.3 Cart Service（购物车域）— :3003

**职责边界：** 购物车全生命周期，连接用户与商品

| 能力 | 说明 |
|------|------|
| 购物车 CRUD | 添加/修改数量/删除商品 |
| 存储策略 | 登录用户 → Redis Hash；未登录 → 客户端（前端 localStorage） |
| 合并购物车 | 登录时合并匿名购物车到用户购物车 |
| 商品快照 | 添加时记录价格快照，结算时实时校验 |
| 勾选状态 | 支持部分商品勾选结算 |
| 库存预校验 | 加入购物车时检查库存（非锁定，仅提示） |

**不负责：** 库存扣减、订单创建、支付

### 2.4 Order Service（订单与支付域）— :3004

**职责边界：** 订单全生命周期 + 支付集成

| 能力 | 说明 |
|------|------|
| 订单创建 | 购物车结算 → 库存预扣 → 生成订单 |
| 订单状态机 | pending → paid → shipped → delivered → completed / cancelled / refunded |
| 支付集成 | 支付网关对接预留（Stripe / 支付宝 / 微信） |
| 支付回调 | 异步通知处理 + 幂等校验 |
| 订单超时 | Redis 延时队列，30 分钟未支付自动取消 + 释放库存 |
| 订单查询 | 用户订单列表 + 详情 + 状态追踪 |
| 幂等设计 | 每个创建/支付请求携带幂等 key，防止重复提交 |

**不负责：** 物流追踪、退款审核、发票

### 2.5 API Gateway — :3000

**职责边界：** 唯一外部入口，横切关注点

| 能力 | 说明 |
|------|------|
| 路由转发 | `/api/v1/auth/*`, `/api/v1/user/*` → User Service |
|  | `/api/v1/product/*`, `/api/v1/category/*` → Product Service |
|  | `/api/v1/cart/*` → Cart Service |
|  | `/api/v1/order/*`, `/api/v1/payment/*` → Order Service |
|  | `/api/v1/admin/*` → 按二级前缀分发到对应 Service |
| 鉴权 | JWT 验证 + 用户上下文注入 |
| 限流 | 基于 IP / Token 的滑动窗口限流（Redis） |
| 幂等层 | 读取 `X-Idempotency-Key` header，网关级去重 |
| 请求追踪 | traceId 生成 & 向下游透传 |
| 日志 | 统一请求/响应日志 |
| CORS | 跨域策略管理 |

---

## 3. 数据库设计

### 3.1 Schema 隔离策略

每个 service 使用独立 PostgreSQL schema，共享连接池但逻辑隔离：

```sql
CREATE SCHEMA IF NOT EXISTS user_service;
CREATE SCHEMA IF NOT EXISTS product_service;
CREATE SCHEMA IF NOT EXISTS order_service;
-- Cart 主要在 Redis，PG 仅做持久化备份（可选）
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
│ phone       VARCHAR(20)              │
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
│ icon_url    TEXT                     │
│ sort_order  INTEGER        DEFAULT 0 │
│ is_active   BOOLEAN        DEFAULT   │
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
│ brand       VARCHAR(100)             │
│ status      VARCHAR(20)    DEFAULT   │  ← draft / active / archived
│ attributes  JSONB                    │  ← 灵活扩展字段
│ min_price   DECIMAL(12,2)            │  ← 冗余字段，列表展示用（最低SKU价格）
│ max_price   DECIMAL(12,2)            │
│ total_sales INTEGER        DEFAULT 0 │  ← 冗余字段，排序用
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
│ is_primary  BOOLEAN        DEFAULT   │
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
│ cost_price  DECIMAL(12,2)            │  ← 成本价（admin 可见）
│ stock       INTEGER        DEFAULT 0 │  ← DB 真实库存（最终一致）
│ low_stock   INTEGER        DEFAULT 5 │  ← 低库存预警阈值
│ weight      DECIMAL(8,2)             │  ← 克（物流计算用）
│ attributes  JSONB                    │  ← {"color":"红","size":"XL"}
│ barcode     VARCHAR(50)              │
│ status      VARCHAR(20)    DEFAULT   │  ← active / inactive
│ version     INTEGER        DEFAULT 0 │  ← 乐观锁版本号
│ created_at  TIMESTAMPTZ    NOT NULL  │
│ updated_at  TIMESTAMPTZ    NOT NULL  │
└─────────────────────────────────────┘
```

### 3.5 Order Service 表结构

```
┌─────────────────────────────────────────┐
│               orders                     │
├─────────────────────────────────────────┤
│ id              VARCHAR(21)    PK        │
│ order_no        VARCHAR(32)    UNIQUE    │  ← 业务订单号（时间戳+随机）
│ user_id         VARCHAR(21)    NOT NULL  │
│ status          VARCHAR(20)    NOT NULL  │  ← pending/paid/shipped/delivered/completed/cancelled/refunded
│ total_amount    DECIMAL(12,2)  NOT NULL  │  ← 订单总价
│ discount_amount DECIMAL(12,2)  DEFAULT 0 │  ← 优惠金额
│ pay_amount      DECIMAL(12,2)  NOT NULL  │  ← 实付金额 = total - discount
│ payment_method  VARCHAR(20)              │  ← stripe / alipay / wechat
│ payment_no      VARCHAR(100)             │  ← 三方支付流水号
│ paid_at         TIMESTAMPTZ              │
│ shipped_at      TIMESTAMPTZ              │
│ delivered_at    TIMESTAMPTZ              │
│ completed_at    TIMESTAMPTZ              │
│ cancelled_at    TIMESTAMPTZ              │
│ cancel_reason   TEXT                     │
│ remark          TEXT                     │  ← 用户备注
│ idempotency_key VARCHAR(64)    UNIQUE    │  ← 幂等键
│ expires_at      TIMESTAMPTZ    NOT NULL  │  ← 支付截止时间（创建+30min）
│ version         INTEGER        DEFAULT 0 │  ← 乐观锁
│ created_at      TIMESTAMPTZ    NOT NULL  │
│ updated_at      TIMESTAMPTZ    NOT NULL  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│            order_items                   │
├─────────────────────────────────────────┤
│ id              VARCHAR(21)    PK        │
│ order_id        VARCHAR(21)    FK→orders │
│ product_id      VARCHAR(21)    NOT NULL  │
│ sku_id          VARCHAR(21)    NOT NULL  │
│ product_title   VARCHAR(200)   NOT NULL  │  ← 下单时快照
│ sku_attrs       JSONB          NOT NULL  │  ← 下单时快照 {"color":"红","size":"XL"}
│ image_url       TEXT                     │  ← 下单时快照
│ unit_price      DECIMAL(12,2)  NOT NULL  │  ← 下单时价格
│ quantity        INTEGER        NOT NULL  │
│ subtotal        DECIMAL(12,2)  NOT NULL  │  ← unit_price * quantity
│ created_at      TIMESTAMPTZ    NOT NULL  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│          order_addresses                 │
├─────────────────────────────────────────┤
│ id              VARCHAR(21)    PK        │
│ order_id        VARCHAR(21)    FK→orders │  ← UNIQUE（一单一地址）
│ recipient       VARCHAR(100)   NOT NULL  │
│ phone           VARCHAR(20)    NOT NULL  │
│ province        VARCHAR(50)    NOT NULL  │
│ city            VARCHAR(50)    NOT NULL  │
│ district        VARCHAR(50)    NOT NULL  │
│ address         TEXT           NOT NULL  │
│ postal_code     VARCHAR(10)              │
│ created_at      TIMESTAMPTZ    NOT NULL  │
└─────────────────────────────────────────┘
  ← 快照！不 FK 到 user_addresses，用户改地址不影响历史订单

┌─────────────────────────────────────────┐
│         payment_records                  │
├─────────────────────────────────────────┤
│ id              VARCHAR(21)    PK        │
│ order_id        VARCHAR(21)    FK→orders │
│ payment_method  VARCHAR(20)    NOT NULL  │
│ amount          DECIMAL(12,2)  NOT NULL  │
│ status          VARCHAR(20)    NOT NULL  │  ← pending / success / failed / refunded
│ transaction_id  VARCHAR(100)             │  ← 三方交易号
│ raw_notify      JSONB                    │  ← 原始回调报文（审计用）
│ idempotency_key VARCHAR(64)    UNIQUE    │
│ created_at      TIMESTAMPTZ    NOT NULL  │
│ updated_at      TIMESTAMPTZ    NOT NULL  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         stock_operations                 │
├─────────────────────────────────────────┤
│ id              VARCHAR(21)    PK        │
│ sku_id          VARCHAR(21)    NOT NULL  │
│ order_id        VARCHAR(21)              │
│ type            VARCHAR(20)    NOT NULL  │  ← reserve / confirm / release / adjust
│ quantity        INTEGER        NOT NULL  │  ← 正数扣减，负数释放
│ created_at      TIMESTAMPTZ    NOT NULL  │
└─────────────────────────────────────────┘
  ← 库存操作日志，便于对账和排查超卖
```

### 3.6 索引策略

```sql
-- User Service
CREATE INDEX idx_users_email ON user_service.users(email);
CREATE INDEX idx_users_status ON user_service.users(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_addresses_user ON user_service.user_addresses(user_id);
CREATE INDEX idx_refresh_tokens_user ON user_service.refresh_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_tokens_expires ON user_service.refresh_tokens(expires_at) WHERE revoked_at IS NULL;

-- Product Service
CREATE INDEX idx_products_status ON product_service.products(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_slug ON product_service.products(slug);
CREATE INDEX idx_products_brand ON product_service.products(brand) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_sales ON product_service.products(total_sales DESC) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX idx_products_fulltext ON product_service.products
  USING GIN(to_tsvector('simple', title || ' ' || coalesce(description, '') || ' ' || coalesce(brand, '')));
CREATE INDEX idx_products_attrs ON product_service.products USING GIN(attributes);
CREATE INDEX idx_skus_product ON product_service.skus(product_id);
CREATE INDEX idx_skus_code ON product_service.skus(sku_code);
CREATE INDEX idx_skus_stock_low ON product_service.skus(product_id) WHERE stock <= low_stock AND status = 'active';
CREATE INDEX idx_categories_parent ON product_service.categories(parent_id);
CREATE INDEX idx_categories_slug ON product_service.categories(slug);

-- Order Service
CREATE INDEX idx_orders_user ON order_service.orders(user_id);
CREATE INDEX idx_orders_user_status ON order_service.orders(user_id, status);
CREATE INDEX idx_orders_status ON order_service.orders(status);
CREATE INDEX idx_orders_no ON order_service.orders(order_no);
CREATE INDEX idx_orders_expires ON order_service.orders(expires_at) WHERE status = 'pending';
CREATE INDEX idx_orders_idempotency ON order_service.orders(idempotency_key);
CREATE INDEX idx_order_items_order ON order_service.order_items(order_id);
CREATE INDEX idx_order_items_sku ON order_service.order_items(sku_id);
CREATE INDEX idx_payment_records_order ON order_service.payment_records(order_id);
CREATE INDEX idx_stock_ops_sku ON order_service.stock_operations(sku_id);
CREATE INDEX idx_stock_ops_order ON order_service.stock_operations(order_id);
```

---

## 4. Redis 使用规范

### 4.1 Key 命名约定

```
{service}:{resource}:{id}:{sub}

示例：
user:session:blacklist:{tokenJti}      → JWT 黑名单（SET，TTL = token 剩余有效期）
user:profile:{userId}                  → 用户信息缓存（STRING JSON）

product:detail:{productId}             → 商品详情缓存（STRING JSON）
product:hot:list                       → 热门商品列表缓存（STRING JSON）
product:category:tree                  → 分类树缓存（STRING JSON）
product:search:{queryHash}             → 搜索结果缓存（STRING JSON）

stock:{skuId}                          → SKU 可用库存（STRING INT，Lua 原子操作）
stock:lock:{skuId}                     → 库存操作分布式锁（STRING，SET NX EX）

cart:{userId}                          → 购物车（HASH，field=skuId，value=JSON{qty,snapshot}）
cart:anonymous:{sessionId}             → 匿名购物车（可选，如果需要服务端存储）

order:timeout:{orderId}                → 订单超时延迟队列（ZSET，score=过期时间戳）
order:idempotent:{key}                 → 幂等键（STRING，TTL=24h）
order:lock:{orderId}                   → 订单操作锁（STRING，SET NX EX）

gateway:ratelimit:{ip}                 → IP 限流（STRING，滑动窗口）
gateway:ratelimit:user:{userId}        → 用户级限流
```

### 4.2 TTL 策略

| Key 类型 | TTL | 说明 |
|----------|-----|------|
| session blacklist | = access token 剩余有效期 | 登出后阻止旧 token |
| user profile cache | 30 min | 低频变更 |
| product detail cache | 10 min | 中频变更，缓存穿透保护 |
| hot products list | 5 min | 热门列表定期刷新 |
| category tree | 60 min | 极低频变更 |
| search result cache | 3 min | 高频变更，短 TTL |
| stock counter | 无 TTL | 与 DB 同步，持久存在 |
| cart (logged in) | 30 days | 长期保留 |
| order timeout ZSET | 无 TTL | 定时任务消费后删除 |
| idempotent key | 24h | 防止重复提交 |
| rate limit | 滑动窗口 60s | 自动过期 |
| distributed lock | 10-30s | 根据操作时长设置 |

### 4.3 缓存策略

```
Cache-Aside 模式（默认）：
  读：先 Redis → miss → 查 DB → 写 Redis
  写：先写 DB → 删 Redis（不是更新 Redis）

防缓存穿透：
  DB 查无结果 → Redis 写入空值 { "empty": true }，TTL = 60s

防缓存雪崩：
  TTL 加随机抖动：baseTTL + random(0, baseTTL * 0.2)

防缓存击穿（热 key）：
  使用分布式锁，只允许一个请求回源 DB，其余等待
```

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
4. 登出 → refresh token 写入 revoked_at + access token JTI 加入 Redis 黑名单
```

### 5.2 JWT Payload

```typescript
{
  sub: string;      // userId
  email: string;
  jti: string;      // token 唯一 ID（用于黑名单）
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
| 409 | ConflictError | 资源冲突（邮箱已注册 / 幂等键重复） |
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
  ADDRESS_LIMIT        = "USER_1008",   // 收货地址数量上限

  // Product 域 (2xxx)
  PRODUCT_NOT_FOUND    = "PRODUCT_2001",
  SKU_NOT_FOUND        = "PRODUCT_2002",
  STOCK_INSUFFICIENT   = "PRODUCT_2003",
  CATEGORY_NOT_FOUND   = "PRODUCT_2004",
  DUPLICATE_SKU_CODE   = "PRODUCT_2005",
  INVALID_PRICE        = "PRODUCT_2006",
  PRODUCT_UNAVAILABLE  = "PRODUCT_2007", // 商品已下架

  // Cart 域 (3xxx)
  CART_ITEM_NOT_FOUND  = "CART_3001",
  CART_LIMIT_EXCEEDED  = "CART_3002",   // 购物车商品数量上限
  CART_SKU_UNAVAILABLE = "CART_3003",   // 加入的 SKU 已下架
  CART_PRICE_CHANGED   = "CART_3004",   // 结算时价格已变动

  // Order 域 (4xxx)
  ORDER_NOT_FOUND      = "ORDER_4001",
  ORDER_STATUS_INVALID = "ORDER_4002",  // 状态流转不合法
  ORDER_EXPIRED        = "ORDER_4003",  // 订单已超时
  ORDER_ALREADY_PAID   = "ORDER_4004",
  ORDER_CANCEL_DENIED  = "ORDER_4005",  // 已发货不可取消
  PAYMENT_FAILED       = "ORDER_4006",
  IDEMPOTENT_CONFLICT  = "ORDER_4007",  // 幂等键已存在（返回原订单）

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
  code: 200,
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
  message: "",
  traceId: "..."
}
```

### 7.3 路由表

```
# ──── 公开路由（无需认证）────────────────────────────────
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh

POST   /api/v1/product/list
POST   /api/v1/product/detail            # Body: { "id": "xxx" }
POST   /api/v1/product/search            # Body: { "keyword": "...", "page": 1, ... }
POST   /api/v1/product/sku/list          # Body: { "productId": "xxx" }

POST   /api/v1/category/list
POST   /api/v1/category/detail           # Body: { "id": "xxx" }
POST   /api/v1/category/tree             # 返回完整分类树

# ──── 需要认证 ──────────────────────────────────────────
POST   /api/v1/auth/logout

POST   /api/v1/user/profile              # 获取当前用户信息
POST   /api/v1/user/update               # Body: { "nickname": "...", ... }
POST   /api/v1/user/address/list
POST   /api/v1/user/address/create
POST   /api/v1/user/address/update       # Body: { "id": "xxx", ... }
POST   /api/v1/user/address/delete       # Body: { "id": "xxx" }

# ──── 购物车（需要认证）────────────────────────────────
POST   /api/v1/cart/list                 # 获取购物车列表（含商品实时信息）
POST   /api/v1/cart/add                  # Body: { "skuId": "xxx", "quantity": 2 }
POST   /api/v1/cart/update               # Body: { "skuId": "xxx", "quantity": 3 }
POST   /api/v1/cart/remove               # Body: { "skuIds": ["xxx", "yyy"] }
POST   /api/v1/cart/clear                # 清空购物车
POST   /api/v1/cart/select               # Body: { "skuIds": ["xxx"], "selected": true }
POST   /api/v1/cart/checkout/preview      # 结算预览（校验库存+价格，返回订单预览）

# ──── 订单（需要认证）──────────────────────────────────
POST   /api/v1/order/create              # Body: { "addressId": "xxx", "items": [...], "idempotencyKey": "xxx" }
POST   /api/v1/order/list                # Body: { "page": 1, "status": "paid" }
POST   /api/v1/order/detail              # Body: { "orderId": "xxx" }
POST   /api/v1/order/cancel              # Body: { "orderId": "xxx", "reason": "..." }

# ──── 支付（需要认证）──────────────────────────────────
POST   /api/v1/payment/create            # Body: { "orderId": "xxx", "method": "stripe" }
POST   /api/v1/payment/notify            # 三方回调（公开，但需签名验证）
POST   /api/v1/payment/query             # Body: { "orderId": "xxx" } 查询支付状态

# ──── 管理端（需要 admin 角色 — 未来实现）──────────────
POST   /api/v1/admin/product/create
POST   /api/v1/admin/product/update      # Body: { "id": "xxx", ... }
POST   /api/v1/admin/product/delete      # Body: { "id": "xxx" }
POST   /api/v1/admin/product/sku/create  # Body: { "productId": "xxx", ... }
POST   /api/v1/admin/product/sku/update  # Body: { "skuId": "xxx", ... }
POST   /api/v1/admin/category/create
POST   /api/v1/admin/category/update     # Body: { "id": "xxx", ... }
POST   /api/v1/admin/order/list          # 管理端订单列表
POST   /api/v1/admin/order/ship          # Body: { "orderId": "xxx", "trackingNo": "..." }
POST   /api/v1/admin/stock/adjust        # Body: { "skuId": "xxx", "quantity": 100, "type": "adjust" }
```

---

## 8. 库存与并发控制

### 8.1 库存扣减流程（下单时）

```
1. 用户点击「提交订单」
       │
2. [Redis Lua 脚本] 原子扣减库存
       │  → 成功：stock:{skuId} -= quantity
       │  → 失败：返回 STOCK_INSUFFICIENT
       │
3. [PostgreSQL 事务]
       │  → 创建 order + order_items + order_address
       │  → 创建 stock_operation (type=reserve)
       │
4. 返回 orderId + 支付信息
       │
5. [定时任务] 30 分钟后检查：
       │  → 已支付：stock_operation (type=confirm)
       │           → UPDATE skus SET stock = stock - qty, version = version + 1
       │              WHERE id = :id AND version = :version (乐观锁)
       │  → 未支付：stock_operation (type=release)
       │           → [Redis Lua] stock:{skuId} += quantity
       │           → 订单状态 → cancelled
```

### 8.2 Redis Lua 库存扣减脚本

```lua
-- KEYS[1] = stock:{skuId}
-- ARGV[1] = quantity
local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then return -1 end          -- key 不存在
if stock < tonumber(ARGV[1]) then return 0 end  -- 库存不足
redis.call('DECRBY', KEYS[1], ARGV[1])
return 1  -- 扣减成功
```

**多 SKU 原子扣减（一个订单多个商品）：**

```lua
-- KEYS = [stock:sku1, stock:sku2, ...]
-- ARGV = [qty1, qty2, ...]
-- 先检查所有库存是否足够（两阶段）
for i = 1, #KEYS do
  local stock = tonumber(redis.call('GET', KEYS[i]))
  if stock == nil or stock < tonumber(ARGV[i]) then
    return i  -- 返回第几个 SKU 库存不足（> 0 表示失败）
  end
end
-- 全部足够，执行扣减
for i = 1, #KEYS do
  redis.call('DECRBY', KEYS[i], ARGV[i])
end
return 0  -- 成功
```

### 8.3 库存同步机制

```
Redis (stock:{skuId})  ←→  PostgreSQL (skus.stock)

初始化：服务启动时，从 DB 加载所有 active SKU 库存到 Redis
日常：Redis 作为预扣层，DB 作为最终一致层
对账：定时任务每 5 分钟对比 Redis 与 DB 库存，修复漂移
管理员调整：先写 DB → 再更新 Redis（管理端操作走 DB 优先）
```

### 8.4 订单超时自动取消

```
实现方式：Redis Sorted Set（ZSET）作为延迟队列

下单时：
  ZADD order:timeout {过期时间戳} {orderId}

定时轮询（每 10 秒）：
  ZRANGEBYSCORE order:timeout 0 {now} LIMIT 0 100
  → 对每个 orderId：
    → 检查订单状态是否仍为 pending
    → 是：执行取消 + 释放库存
    → 否：跳过（已支付/已取消）
    → ZREM order:timeout {orderId}
```

### 8.5 幂等设计

```
创建订单：
  Header: X-Idempotency-Key: {clientGeneratedUUID}
  → Gateway 层：检查 Redis order:idempotent:{key}
    → 存在：返回 409 + 原订单信息（IDEMPOTENT_CONFLICT）
    → 不存在：SET NX order:idempotent:{key} EX 86400 → 继续处理

支付回调：
  根据三方 transaction_id 查询 payment_records
  → 已存在 success 记录：直接返回成功（幂等）
  → 不存在：创建记录，更新订单状态
```

---

## 9. 购物车设计

### 9.1 存储模型

```
Redis Hash: cart:{userId}
  field: {skuId}
  value: JSON {
    "quantity": 2,
    "selected": true,
    "addedAt": "2025-01-01T00:00:00Z",
    "snapshot": {                      ← 加入时的价格快照
      "productId": "xxx",
      "productTitle": "...",
      "skuAttrs": {"color":"红"},
      "price": 99.00,
      "imageUrl": "..."
    }
  }

单用户购物车上限：50 个 SKU（CART_LIMIT_EXCEEDED）
```

### 9.2 购物车列表查询

```
1. HGETALL cart:{userId}
2. 批量查询 SKU 最新信息（价格、库存、状态）
3. 对比快照，标记变化：
   → 价格变动：返回 priceChanged: true + 新旧价格
   → 已下架：返回 unavailable: true
   → 库存不足：返回 stockInsufficient: true
4. 返回合并后的购物车列表
```

### 9.3 结算预览（checkout/preview）

```
1. 获取勾选的购物车商品
2. 实时查询所有 SKU 最新价格 + 库存
3. 校验：价格是否变动、库存是否充足、商品是否可售
4. 计算：商品总价、运费（预留）、优惠（预留）、实付金额
5. 返回预览信息（不扣库存，不创建订单）
6. 如有异常（价格变动/库存不足），返回具体异常信息让前端提示
```

---

## 10. 服务间通信

### 10.1 当前方案

直接 HTTP 调用，Gateway 作为唯一外部入口。服务间通信通过内部 Docker 网络。

```typescript
// Gateway 转发示例
const resp = await fetch(`http://user-service:3001/internal/user/detail`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-trace-id": traceId,
    "x-user-id": userId,
    "x-internal-token": INTERNAL_SECRET  // 服务间鉴权
  },
  body: JSON.stringify({ id: userId })
});
```

### 10.2 内部 API 约定

```
服务间调用使用 /internal/ 前缀，与外部 API 区分：
  POST /internal/user/detail        → User Service 内部接口
  POST /internal/product/sku/batch  → 批量查询 SKU（购物车/订单用）
  POST /internal/stock/reserve      → 库存预扣
  POST /internal/stock/release      → 库存释放
  POST /internal/stock/confirm      → 库存确认

/internal/ 路由仅允许 Docker 内部网络访问，Gateway 不对外暴露。
```

### 10.3 事件总线（Redis Streams）

```
用于异步通知，非强一致性场景：

stream:order.created   → 订单创建后通知（清理购物车、发送确认邮件...）
stream:order.paid      → 支付成功后通知（更新销量、发货提醒...）
stream:order.cancelled → 订单取消后通知（释放库存已在同步流程中）
stream:stock.low       → 库存低于阈值后通知（管理员告警）

每个 service 作为 consumer group 独立消费，互不阻塞。
```

---

## 11. 搜索与性能优化

### 11.1 商品搜索

```
当前方案（PostgreSQL 全文搜索）：
  → 使用 ts_vector + GIN 索引
  → 支持中文需配置 pg_jieba 或 zhparser 分词插件
  → 搜索结果按 ts_rank 排序 + 权重（标题权重 > 描述）

搜索接口 /api/v1/product/search：
  Body: {
    "keyword": "运动鞋",
    "categoryId": "xxx",       ← 可选，分类筛选
    "priceMin": 100,           ← 可选，价格区间
    "priceMax": 500,
    "sort": "relevance",       ← relevance / price_asc / price_desc / sales / newest
    "page": 1,
    "pageSize": 20
  }

缓存：搜索结果按 queryHash 缓存 3 分钟
```

### 11.2 多级缓存架构

```
                请求
                 │
          ┌──────▼──────┐
          │  Gateway     │  ← 限流、鉴权
          └──────┬──────┘
                 │
          ┌──────▼──────┐
     L1   │  Redis 缓存  │  ← 热数据，TTL + 随机抖动
          └──────┬──────┘
                 │ miss
          ┌──────▼──────┐
     L2   │  PostgreSQL  │  ← 冷数据，连接池限制并发
          └──────┬──────┘
                 │ 查询结果
          ┌──────▼──────┐
          │  回写 Redis  │  ← Cache-Aside
          └─────────────┘
```

### 11.3 热点数据优化

```
首页商品列表、分类树、热门搜索词：
  → 定时任务预热（启动时 + 定时刷新）
  → 不走 Cache-Aside，直接定时覆盖

商品详情页：
  → Cache-Aside + 分布式锁防击穿
  → 同一个 productId 只允许一个请求回源

搜索结果：
  → 短 TTL（3 min）+ queryHash 缓存
  → 热门搜索词结果预热

SKU 库存：
  → 不缓存，直接读 Redis stock:{skuId}（已是内存）
```

### 11.4 数据库连接池配置

```typescript
// packages/database/src/client.ts
{
  max: 20,           // 最大连接数（单 service）
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
}
// 4 个 service × 20 = 80 连接 < PG 默认 max_connections(100)
// 生产环境需根据实例规格调整
```

---

## 12. 安全清单

| 项目 | 实现 | 阶段 |
|------|------|------|
| HTTPS 终止 | Caddy 自动证书 | Phase 1 |
| 密码哈希 | Argon2id | Phase 4 |
| JWT 短期 Token + JTI | 15 min + refresh + 黑名单 | Phase 4 |
| CORS 白名单 | Gateway 中间件 | Phase 7 |
| 限流 | Redis 滑动窗口（IP + 用户双维度） | Phase 7 |
| SQL 注入防护 | Drizzle 参数化查询 | Phase 3 |
| XSS 防护 | Hono secure headers | Phase 7 |
| 环境变量隔离 | .env 不入仓库 | Phase 1 |
| 请求追踪 | traceId 全链路 | Phase 2 |
| 幂等设计 | X-Idempotency-Key + Redis 去重 | Phase 6 |
| 支付签名验证 | 回调报文签名校验 | Phase 6 |
| 服务间鉴权 | x-internal-token + 网络隔离 | Phase 7 |
| 订单金额校验 | 服务端重新计算，不信任前端金额 | Phase 6 |
| 库存防超卖 | Redis Lua 原子操作 + 乐观锁 | Phase 5 |

---

## 13. 分阶段开发路线图

> **每个阶段 = 一个独立的 Claude Code CLI 会话**  
> 每个阶段标注了：目标产出、验收标准、预估工作量  
> 阶段间通过文件（代码 + 文档）传递上下文，不依赖对话历史

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
5. services/user-service、product-service、cart-service、order-service 空骨架
6. infra/docker/docker-compose.yml（PostgreSQL 16 + Redis 7）
7. infra/caddy/Caddyfile（反向代理到 api-gateway:3000）
8. .env.example 模板（包含所有服务端口、DB/Redis 连接信息、JWT 密钥占位、内部通信密钥）
9. 根目录 Makefile（dev / build / test / docker-up / docker-down / migrate）
不写任何业务代码。
```

**产出物：**
- `package.json`（root）— workspace 配置
- `tsconfig.json`（root）+ 各包 `tsconfig.json`
- 所有包的 `package.json` + 空入口文件
- `docker-compose.yml` — PG + Redis + Caddy
- `Caddyfile`
- `.env.example`
- `Makefile`

**验收标准：**
- [ ] `bun install` 无错误
- [ ] `docker compose up -d` 启动 PG + Redis + Caddy
- [ ] `docker compose ps` 全部 healthy
- [ ] 各包的 `bun run build` 不报错（即使是空包）
- [ ] workspace 引用 `@repo/shared` 和 `@repo/database` 类型正确

**预估：** 1 个会话

---

### Phase 2: packages/shared — 通用基础能力

**目标：** 错误体系、响应格式、核心中间件全部就绪，可被所有服务引用

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 2 + 错误码体系 + 响应格式章节。
实现 packages/shared，按以下顺序：
1. config/ — 环境变量加载 & Zod schema 校验（涵盖所有服务的配置项）
2. errors/ — AppError 基类 + 所有 HTTP 错误子类 + 完整业务错误码枚举（含 User/Product/Cart/Order/Gateway 全部错误码）
3. response/ — 统一 success() / error() 响应构建器
4. types/ — 全局 TS 类型（Pagination, SortOrder, ServiceContext 等）
5. utils/id.ts — nanoid ID 生成器 + 订单号生成器（时间戳+随机）
6. utils/time.ts — 时间工具
7. utils/hash.ts — 密码哈希（Argon2 封装）+ SHA-256 工具
8. utils/jwt.ts — JWT 签发/验证/解析工具（access + refresh token）
9. middleware/error-handler.ts — 全局异常捕获 → 统一响应
10. middleware/request-id.ts — traceId 注入
11. middleware/logger.ts — 请求日志（method, path, status, duration）
12. middleware/validate.ts — Zod 参数校验中间件
13. middleware/auth.ts — JWT 鉴权中间件（验证 access token + Redis 黑名单检查）
14. middleware/idempotent.ts — 幂等中间件（读取 X-Idempotency-Key，Redis 检查）
15. index.ts — 统一导出
每个模块写对应的 .test.ts 单元测试。
```

**产出物：**
- `packages/shared/src/` 完整实现
- 每个模块的 `*.test.ts`

**验收标准：**
- [ ] `bun test` 全部通过
- [ ] 从其他包 `import { AppError, NotFoundError, success, validate, generateId, signAccessToken } from "@repo/shared"` 无类型错误
- [ ] error-handler 中间件能捕获所有 AppError 子类并转为统一响应
- [ ] auth 中间件能验证 JWT 并注入用户上下文
- [ ] idempotent 中间件能检测重复请求
- [ ] config 模块缺少必要环境变量时启动即报错

**预估：** 1-2 个会话

---

### Phase 3: packages/database — 数据库与 Redis 层

**目标：** 所有域的 Drizzle schema 定义完成，迁移可执行，PG + Redis 连接就绪

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 3 + 全部数据库设计章节（3.3-3.5）+ 索引策略（3.6）。
实现 packages/database：
1. client.ts — Drizzle + PostgreSQL 连接池（使用 @repo/shared 的 config）
2. redis.ts — Redis 连接封装（ioredis），含 Lua 脚本加载机制
3. schema/users.ts — users, user_addresses, refresh_tokens 表（user_service schema）
4. schema/products.ts — products, categories, product_categories, product_images, skus 表（product_service schema）
5. schema/orders.ts — orders, order_items, order_addresses, payment_records, stock_operations 表（order_service schema）
6. schema/index.ts — 统一导出所有 schema
7. lua/stock-deduct.lua — 单 SKU 库存扣减脚本
8. lua/stock-deduct-multi.lua — 多 SKU 原子扣减脚本
9. lua/stock-release.lua — 库存释放脚本
10. migrate.ts — 迁移执行入口（可 `bun run migrate` 执行）
11. seed.ts — 开发种子数据（用户 + 分类 + 商品 + SKU + 库存初始化到 Redis）
12. index.ts — 导出 db, redis, schema, lua scripts, types
确保所有索引按 architecture.md 3.6 节定义。
所有表使用 PostgreSQL schema 隔离（user_service.users, product_service.products, order_service.orders）。
```

**产出物：**
- `packages/database/src/` 完整实现
- Drizzle 迁移文件
- Redis Lua 脚本
- 种子数据脚本

**验收标准：**
- [ ] `bun run migrate` 在本地 PG 执行成功
- [ ] 所有表和索引与 architecture.md 一致
- [ ] 3 个 PG schema（user_service, product_service, order_service）正确创建
- [ ] `db.select().from(users)` 类型正确
- [ ] Redis 连接 ping 成功
- [ ] Lua 脚本可通过 `redis.evalsha()` 调用
- [ ] `bun run seed` 创建测试数据 + Redis 库存初始化

**预估：** 1-2 个会话

---

### Phase 4: services/user-service — 用户与认证域

**目标：** 完整的用户注册/登录/JWT/资料/地址管理 API

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 4 + User Service 边界定义 + 认证设计（第5章）。
实现 services/user-service，端口 :3001：
1. Hono app 实例 + 路由挂载
2. 分层结构：routes/ → services/ → repositories/
3. auth 路由：POST /api/v1/auth/register, login, refresh, logout
4. user 路由：POST /api/v1/user/profile, update
5. address 路由：POST /api/v1/user/address/list, create, update, delete
6. 内部路由：POST /internal/user/detail, batch（供其他服务调用）
7. 业务逻辑层：
   → 注册：邮箱查重 → Argon2 哈希 → 创建用户 → 签发 JWT
   → 登录：邮箱查询 → Argon2 验证 → 签发 JWT（access + refresh）
   → 刷新：验证 refresh token → 签发新 access token
   → 登出：refresh token revoke + access token JTI 加入 Redis 黑名单
8. 使用 @repo/shared 中间件 + @repo/database
9. 集成测试（模拟 HTTP 请求测试所有路由）
```

**产出物：**
- `services/user-service/src/` 完整实现（routes, services, repositories 分层）
- 集成测试

**验收标准：**
- [ ] 注册 → 登录 → 获取 profile → 更新资料 → 登出 全流程跑通
- [ ] refresh token 可换新 access token
- [ ] 登出后旧 access token 被拒绝（Redis 黑名单生效）
- [ ] 地址 CRUD 全流程 + 默认地址切换
- [ ] 重复邮箱注册返回 409 + USER_1002
- [ ] 错误密码登录返回 401 + USER_1003
- [ ] 未认证请求返回 401
- [ ] /internal/ 路由可正常调用
- [ ] 所有测试通过

**预估：** 1-2 个会话

---

### Phase 5: services/product-service — 商品与库存域

**目标：** 商品 CRUD、分类管理、SKU/库存管理、全文搜索

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 5 + Product Service 边界 + 库存并发控制（第8章）+ 搜索优化（第11章）。
实现 services/product-service，端口 :3002：
1. Hono app 实例 + 路由挂载
2. 分层结构：routes/ → services/ → repositories/
3. product 路由：POST /api/v1/product/list, detail, search
4. category 路由：POST /api/v1/category/list, detail, tree
5. sku 路由：POST /api/v1/product/sku/list
6. 内部路由：
   → POST /internal/product/sku/batch — 批量查询 SKU 详情（购物车/订单用）
   → POST /internal/stock/reserve — 库存预扣（Redis Lua 原子扣减）
   → POST /internal/stock/release — 库存释放
   → POST /internal/stock/confirm — 库存确认（DB 乐观锁更新）
   → POST /internal/stock/sync — 强制同步 Redis 与 DB 库存
7. 商品搜索：PostgreSQL 全文搜索 + ts_rank 排序 + 搜索结果 Redis 缓存
8. 缓存实现：
   → 商品详情 Cache-Aside（TTL 10min + 随机抖动）
   → 分类树定时预热（TTL 60min）
   → 搜索结果短缓存（TTL 3min）
   → 缓存穿透防护（空值缓存 60s）
   → 缓存击穿防护（分布式锁回源）
9. 库存管理：
   → Redis Lua 脚本原子扣减/释放
   → DB 乐观锁（skus.version）最终一致
   → stock_operations 日志记录所有操作
10. Admin 路由：POST /api/v1/admin/product/create, update, delete, sku/create, sku/update, category/create, update
11. 使用 @repo/shared + @repo/database
12. 集成测试
```

**产出物：**
- `services/product-service/src/` 完整实现
- 集成测试

**验收标准：**
- [ ] 商品 CRUD 全流程（admin 路由）
- [ ] 分页 + 多条件筛选 + 排序
- [ ] 全文搜索返回相关结果并按 relevance 排序
- [ ] 分类树查询正确（多级嵌套）
- [ ] SKU 创建后 Redis 库存自动初始化
- [ ] /internal/stock/reserve 并发 100 次，库存准确无超卖
- [ ] 缓存命中日志可见（cache HIT / MISS）
- [ ] 乐观锁冲突时 stock/confirm 正确重试或失败
- [ ] 所有测试通过

**预估：** 2-3 个会话

---

### Phase 6: services/cart-service + services/order-service — 购物车、订单与支付域

**目标：** 购物车全功能 + 订单完整生命周期 + 支付预留 + 幂等

**Claude Code 提示词（会话 6a — Cart Service）：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 6 + 购物车设计（第9章）。
实现 services/cart-service，端口 :3003：
1. Hono app 实例 + 路由挂载
2. 分层结构：routes/ → services/
3. 购物车路由：POST /api/v1/cart/list, add, update, remove, clear, select
4. 结算预览：POST /api/v1/cart/checkout/preview
5. 内部路由：POST /internal/cart/clear-items（订单创建后清理已下单商品）
6. 存储：Redis Hash (cart:{userId})
7. 商品快照：add 时记录价格快照，list/preview 时与实时数据对比标记变动
8. 库存预校验：add 时检查库存是否充足（仅提示，不锁定）
9. 结算预览：实时校验所有勾选商品的价格/库存/状态，计算总价
10. 调用 Product Service 内部接口获取 SKU 实时数据
11. 使用 @repo/shared + @repo/database（仅 Redis）
12. 集成测试
```

**Claude Code 提示词（会话 6b — Order Service）：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 6 + 订单表结构（3.5）+ 库存流程（第8章）+ 幂等设计（8.5）。
实现 services/order-service，端口 :3004：
1. Hono app 实例 + 路由挂载
2. 分层结构：routes/ → services/ → repositories/
3. 订单路由：POST /api/v1/order/create, list, detail, cancel
4. 支付路由：POST /api/v1/payment/create, notify, query
5. 管理端路由：POST /api/v1/admin/order/list, ship, stock/adjust
6. 订单创建流程（核心）：
   → 幂等检查（idempotencyKey）
   → 调用 Product Service /internal/product/sku/batch 获取实时价格
   → 服务端重新计算金额（不信任前端）
   → 调用 Product Service /internal/stock/reserve（Redis Lua 多 SKU 原子扣减）
   → PG 事务创建 order + order_items + order_address + stock_operations
   → ZADD order:timeout（设置 30 分钟超时）
   → 调用 Cart Service /internal/cart/clear-items（清理已下单商品）
   → 返回 orderId + 支付信息
7. 订单状态机：
   → pending → paid（支付成功回调）
   → pending → cancelled（用户取消 / 超时取消）
   → paid → shipped（管理员发货）
   → shipped → delivered → completed
   → 任何非法流转返回 ORDER_STATUS_INVALID
8. 支付回调：
   → 签名验证（预留）
   → 幂等检查（transaction_id）
   → 创建 payment_record
   → 更新订单状态 → paid
   → 调用 /internal/stock/confirm（DB 乐观锁确认）
9. 订单超时处理：
   → 定时任务（每 10 秒）轮询 order:timeout ZSET
   → 过期订单：更新状态 → cancelled + 调用 /internal/stock/release + 记录 stock_operation
10. 使用 @repo/shared + @repo/database
11. 集成测试
```

**产出物：**
- `services/cart-service/src/` 完整实现
- `services/order-service/src/` 完整实现
- 两个服务的集成测试

**验收标准：**
- [ ] 购物车 CRUD 全流程（add → list → update → select → remove → clear）
- [ ] 结算预览正确计算金额 + 检测价格变动/库存不足
- [ ] 下单全流程：购物车 → 结算预览 → 创建订单 → 库存已扣 → 购物车已清理
- [ ] 重复 idempotencyKey 返回 409 + 原订单
- [ ] 订单状态机所有合法流转正确
- [ ] 非法状态流转返回 422 + ORDER_STATUS_INVALID
- [ ] 支付回调幂等（同一 transaction_id 多次回调只处理一次）
- [ ] 超时自动取消：创建订单 → 等待 30min（测试可缩短）→ 自动取消 + 库存释放
- [ ] 并发下单同一 SKU：库存扣减准确，无超卖
- [ ] 所有测试通过

**预估：** 3-4 个会话（Cart 1 个，Order 2-3 个）

---

### Phase 7: apps/api-gateway — 网关整合

**目标：** 唯一外部入口，路由转发 + 完整中间件链 + 端到端打通

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 7 + API Gateway 定义 + 路由表（7.3）。
实现 apps/api-gateway，端口 :3000：
1. Hono app 主入口
2. 中间件链：request-id → logger → cors → rate-limit → auth → idempotent → error-handler
3. 路由转发规则：
   → /api/v1/auth/*, /api/v1/user/* → http://user-service:3001
   → /api/v1/product/*, /api/v1/category/* → http://product-service:3002
   → /api/v1/cart/* → http://cart-service:3003
   → /api/v1/order/*, /api/v1/payment/* → http://order-service:3004
   → /api/v1/admin/* → 按二级前缀分发（admin/product → :3002, admin/order → :3004, admin/stock → :3002）
4. 公开路由白名单（不经过 auth）：register, login, refresh, product/list, product/detail, product/search, product/sku/list, category/*, payment/notify
5. 限流实现：Redis 滑动窗口
   → 未认证：按 IP，100 次/分钟
   → 已认证：按 userId，300 次/分钟
   → 特定路由自定义（如 payment/notify 更宽松）
6. 幂等层：对 order/create, payment/create 自动检查 X-Idempotency-Key
7. 健康检查：POST /health（检查各下游服务 + PG + Redis）
8. 服务间鉴权：转发时注入 x-internal-token header
9. 端到端测试：
   → 启动全部服务
   → 注册 → 登录 → 浏览商品 → 加入购物车 → 结算预览 → 下单 → 模拟支付 → 查询订单
   → 全链路 traceId 一致性验证
```

**产出物：**
- `apps/api-gateway/src/` 完整实现
- 端到端测试脚本

**验收标准：**
- [ ] 所有路由通过 gateway 访问正常
- [ ] 公开路由可匿名访问
- [ ] 认证路由未登录返回 401
- [ ] 限流触发后返回 429
- [ ] traceId 贯穿全链路（gateway → service → 响应）
- [ ] /health 返回各下游服务 + PG + Redis 状态
- [ ] 端到端测试全流程通过
- [ ] /internal/ 路由从外部不可访问

**预估：** 1-2 个会话

---

### Phase 8: 部署 + 联调 + 性能调优

**目标：** Docker 多阶段构建 + 完整部署 + 性能验证

**Claude Code 提示词：**
```
请参考 CLAUDE.md 和 docs/architecture.md Phase 8。
完成部署与性能优化：
1. 每个 service/app 的 Dockerfile（多阶段构建 Bun，最小化镜像）
2. 完整 docker-compose.yml：
   → infra: postgres(16) + redis(7) + caddy
   → apps: api-gateway
   → services: user-service + product-service + cart-service + order-service
   → 依赖关系 + 健康检查 + 重启策略
3. Caddyfile 完善（TLS / 反向代理 / 压缩 / 安全 headers）
4. PostgreSQL 调优（shared_buffers, work_mem, max_connections）
5. Redis 调优（maxmemory, maxmemory-policy=allkeys-lru）
6. 库存同步定时任务（Redis ↔ DB 对账，每 5 分钟）
7. 缓存预热脚本（服务启动时加载热点数据）
8. 编写 docs/deployment.md（部署步骤 + 环境变量说明 + 运维手册）
9. 全链路冒烟测试脚本
10. 简易压测脚本（验证库存并发安全性）
```

**产出物：**
- 各服务 Dockerfile
- 完整 `docker-compose.yml`
- 完善的 Caddyfile
- PG/Redis 配置文件
- `docs/deployment.md`
- 冒烟测试 + 压测脚本

**验收标准：**
- [ ] `docker compose up` 一键启动全部服务（含依赖等待）
- [ ] 通过 Caddy（:443 或 :80）访问所有 API
- [ ] 冒烟测试脚本全部通过
- [ ] 压测 100 并发下单同一 SKU：库存准确、无超卖
- [ ] 各服务日志可通过 `docker compose logs -f` 查看
- [ ] 服务重启后缓存自动预热 + 库存自动同步

**预估：** 1-2 个会话

---

### Phase 9+: 未来演进（备忘）

以下为后续可扩展方向，不在当前开发范围内：

| 方向 | 说明 |
|------|------|
| Notification Service | 邮件、短信、站内信（订单状态变更通知） |
| File Service | 图片上传 + CDN 集成（S3 / R2） |
| Admin Dashboard | 管理后台前端（React / Vue） |
| RBAC | 角色权限管理（admin / operator / viewer） |
| 促销 & 优惠券 | 优惠计算引擎、券管理 |
| 退款 Service | 退款审核、资金原路退回 |
| 物流 Service | 物流单号追踪、三方对接 |
| 监控 | Prometheus + Grafana（QPS / 延迟 / 错误率） |
| CI/CD | GitHub Actions 自动化（测试 → 构建 → 部署） |
| 独立搜索 | Meilisearch / Typesense（替代 PG 全文搜索） |
| 消息队列升级 | Redis Streams → Kafka（超高吞吐场景） |
