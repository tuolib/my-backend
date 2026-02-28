




## 阶段 2：数据库建模与分层

# stop pre

项目介绍：企业级高并发电商架构
对标: Amazon / 阿里巴巴
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
工程结构：Monorepo

已完成：
- 阶段1 基础工程骨架
- 共享层：统一配置、统一响应格式、统一错误处理
- 基础设施：Dockerfile, docker-compose, Caddyfile

当前处于阶段：阶段2，数据库建模与分层

目标：
- 设计面向高并发电商的 PostgreSQL 数据模型，建立 Repository 模式，为读写分离预留接口。

### 操作清单
- [ ] 选择 ORM/Query Builder（Drizzle ORM 推荐）
- [ ] 设计核心表：users, products, skus, categories, orders, order_items, cart_items, payments, inventory
- [ ] 建立数据库迁移体系（drizzle-kit）
- [ ] 抽象 Repository 基类（CRUD 泛型）
- [ ] 数据库连接池配置（pg pool）
- [ ] 软删除、乐观锁（version 字段）、审计字段（created_at, updated_at, deleted_at）

你是一位数据库架构师。请为高并发电商系统设计 PostgreSQL 数据模型。

现在要做的是将这个模块分成多步骤实施，请告诉我第一步给Claude Code的提示词





# step 1

项目介绍：企业级高并发电商架构
对标: Amazon / 阿里巴巴
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
工程结构：Monorepo

已完成：
- 阶段1 基础工程骨架
- 共享层：统一配置、统一响应格式、统一错误处理
- 基础设施：Dockerfile, docker-compose, Caddyfile

当前处于阶段：阶段2，数据库建模与分层

目标：
- 设计面向高并发电商的 PostgreSQL 数据模型，建立 Repository 模式，为读写分离预留接口。

### 操作清单
- [ ] 选择 ORM/Query Builder（Drizzle ORM 推荐）
- [ ] 设计核心表：users, products, skus, categories, orders, order_items, cart_items, payments, inventory
- [ ] 建立数据库迁移体系（drizzle-kit）
- [ ] 抽象 Repository 基类（CRUD 泛型）
- [ ] 数据库连接池配置（pg pool）
- [ ] 软删除、乐观锁（version 字段）、审计字段（created_at, updated_at, deleted_at）


你是一位数据库架构师。请为高并发电商系统设计 PostgreSQL 数据模型。

请完成阶段2第一步——数据库基础设施搭建：

1. 在 packages/database 下初始化包：
    - 安装 drizzle-orm, drizzle-kit, postgres（pg driver for drizzle）
    - package.json 配置 name: "@repo/database"

2. 数据库连接池配置：
    - src/client.ts：用 postgres 库创建连接池，从 @repo/shared 读取配置
    - 连接池参数：max: 20, idle_timeout: 30, connect_timeout: 10
    - 导出 db 实例（drizzle(client)）和关闭连接方法

3. 在 @repo/shared 的配置中补充数据库环境变量：
    - DATABASE_URL, DB_POOL_MAX, DB_POOL_IDLE_TIMEOUT

4. drizzle.config.ts 放在 packages/database 根目录

5. 在 docker-compose.yml 中确认 PostgreSQL 服务配置正确，添加 healthcheck

6. 建立目录结构：
   packages/database/
   ├── src/
   │   ├── client.ts        # 连接池
   │   ├── schema/           # 下一步放表定义
   │   └── index.ts          # 统一导出
   ├── drizzle.config.ts
   └── package.json

不要创建任何表结构，只搭建数据库连接基础设施。确保类型安全，代码简洁。



# step 2


项目介绍：企业级高并发电商架构
对标: Amazon / 阿里巴巴
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
工程结构：Monorepo

已完成：
- 阶段1 基础工程骨架
- 共享层：统一配置、统一响应格式、统一错误处理
- 基础设施：Dockerfile, docker-compose, Caddyfile

当前处于阶段：阶段2，数据库建模与分层

目标：
- 设计面向高并发电商的 PostgreSQL 数据模型，建立 Repository 模式，为读写分离预留接口。


项目背景：Bun + Hono Monorepo 电商项目，packages/database 已完成 Drizzle ORM 连接池配置。


你是一位数据库架构师。请为高并发电商系统设计 PostgreSQL 数据模型。

请完成阶段2第二步——核心商品域表结构设计：

在 packages/database/src/schema/ 下创建以下文件：

1. _common.ts — 公共字段工厂函数：
    - baseColumns：id(uuid pk default gen_random_uuid), created_at, updated_at
    - softDelete：deleted_at (timestamp nullable)
    - optimisticLock：version (integer default 1 not null)
    - 所有时间字段用 timestamp with time zone

2. users.ts — 用户表：
    - 继承 baseColumns + softDelete
    - email (unique, not null), password_hash, nickname, phone (unique nullable)
    - status enum: active, inactive, banned
    - email_verified_at (timestamp nullable)
    - 索引：email, phone, status

3. categories.ts — 商品分类（支持无限层级）：
    - 继承 baseColumns + softDelete
    - name, slug (unique), parent_id (self ref nullable), sort_order, is_active
    - ltree 或 materialized path 字段 path 用于高效层级查询
    - 索引：slug, parent_id, path

4. products.ts — 商品SPU：
    - 继承 baseColumns + softDelete + optimisticLock
    - name, slug (unique), description (text), brand
    - category_id (fk categories), status enum: draft, active, inactive
    - 索引：slug, category_id, status

5. skus.ts — 商品SKU（实际售卖单元）：
    - 继承 baseColumns + softDelete + optimisticLock
    - product_id (fk products), sku_code (unique), price (numeric(12,2)), original_price
    - attributes (jsonb，存规格如 {"颜色":"红","尺码":"XL"})
    - stock (integer default 0), low_stock_threshold (integer default 10)
    - is_active (boolean default true)
    - 索引：product_id, sku_code, is_active
    - stock 字段加 CHECK >= 0

6. schema/index.ts 统一导出所有表和 relations

设计原则：
- SPU/SKU 分离，SKU 才持有价格和库存
- 所有金额用 numeric(12,2) 不用 float
- 枚举用 pgEnum 定义
- 定义 drizzle relations（一对多、多对一）
- 每个表文件底部导出 insert/select 的 Zod schema（用 createInsertSchema）





# step 3


项目介绍：企业级高并发电商架构
对标: Amazon / 阿里巴巴
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
工程结构：Monorepo

已完成：
- 阶段1 基础工程骨架
- 共享层：统一配置、统一响应格式、统一错误处理
- 基础设施：Dockerfile, docker-compose, Caddyfile

当前处于阶段：阶段2，数据库建模与分层

目标：
- 设计面向高并发电商的 PostgreSQL 数据模型，建立 Repository 模式，为读写分离预留接口。

项目背景：Bun + Hono Monorepo 电商项目，packages/database/src/schema/ 已完成 _common.ts, users.ts, categories.ts, products.ts, skus.ts。

你是一位数据库架构师

请完成阶段2第三步——订单与交易域表结构设计：

在 packages/database/src/schema/ 下创建以下文件：

1. cart_items.ts — 购物车：
    - 继承 baseColumns
    - user_id (fk users, not null), sku_id (fk skus, not null)
    - quantity (integer, CHECK > 0)
    - unique 约束 (user_id, sku_id) 防重复
    - 索引：user_id
    - 注意：购物车不需要软删除和乐观锁，直接硬删

2. orders.ts — 订单主表：
    - 继承 baseColumns + softDelete + optimisticLock
    - order_no (varchar(32) unique not null) — 业务单号，非自增
    - user_id (fk users, not null)
    - status pgEnum: pending_payment, paid, shipping, delivered, completed, cancelled, refunding, refunded
    - total_amount, discount_amount, shipping_fee, pay_amount — 全部 numeric(12,2)
    - address_snapshot (jsonb) — 下单时收货地址快照，不依赖地址表
    - paid_at, shipped_at, completed_at, cancelled_at (timestamp nullable)
    - cancel_reason (text nullable)
    - 索引：order_no, user_id, status, created_at DESC

3. order_items.ts — 订单明细：
    - 继承 baseColumns
    - order_id (fk orders), sku_id (fk skus)
    - product_snapshot (jsonb) — 下单时商品名称、图片、规格快照
    - price (numeric(12,2)), quantity (integer CHECK > 0)
    - subtotal (numeric(12,2)) — 冗余小计 = price * quantity
    - 索引：order_id, sku_id

4. payments.ts — 支付记录：
    - 继承 baseColumns
    - order_id (fk orders), payment_no (varchar(64) unique)
    - method pgEnum: alipay, wechat, credit_card, balance
    - amount (numeric(12,2))
    - status pgEnum: pending, success, failed, refunded
    - provider_transaction_id (varchar nullable) — 第三方流水号
    - paid_at (timestamp nullable), raw_response (jsonb nullable)
    - 索引：order_id, payment_no, status

5. inventory_logs.ts — 库存流水（审计追踪）：
    - 继承 baseColumns（无需软删除，流水不可删）
    - sku_id (fk skus), change_quantity (integer, 可正可负)
    - type pgEnum: purchase_in, sale_out, return_in, adjust, lock, unlock
    - reference_type (varchar) + reference_id (uuid) — 多态关联(order/adjustment等)
    - before_stock, after_stock (integer) — 变更前后快照
    - operator_id (uuid nullable) — 操作人
    - 索引：sku_id, type, created_at DESC, (reference_type, reference_id)

6. 更新 schema/index.ts 统一导出所有新表和 relations

7. 补充 relations 定义：
    - user hasMany orders, cart_items
    - order hasMany order_items, payments
    - order_item belongsTo order, sku
    - sku hasMany inventory_logs, cart_items
    - payment belongsTo order

设计原则：
- 订单快照（地址、商品）保证历史数据不可变
- 金额全部 numeric(12,2)，subtotal 冗余存储避免运行时计算
- inventory_logs 只追加不修改，保证库存可审计可回溯
- order_no 由业务层生成（如时间戳+随机），不暴露自增ID


# step 4


项目介绍：企业级高并发电商架构
对标: Amazon / 阿里巴巴
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
工程结构：Monorepo

已完成：
- 阶段1 基础工程骨架
- 共享层：统一配置、统一响应格式、统一错误处理
- 基础设施：Dockerfile, docker-compose, Caddyfile

当前处于阶段：阶段2，数据库建模与分层

目标：
- 设计面向高并发电商的 PostgreSQL 数据模型，建立 Repository 模式，为读写分离预留接口。



项目背景：Bun + Hono Monorepo 电商项目，packages/database/src/schema/ 已完成全部表结构（users, categories, products, skus, cart_items, orders, order_items, payments, inventory_logs）。

你是一位数据库架构师

请完成阶段2第四步——Repository 模式抽象与数据库迁移体系：

一、Repository 基类 packages/database/src/repository/base.repository.ts：

1. BaseRepository<TTable, TInsert, TSelect> 泛型类：
    - 构造函数接收 db 实例和 table 引用
    - findById(id: string): Promise<TSelect | null>
    - findMany(options: QueryOptions): Promise<PaginatedResult<TSelect>>
        - QueryOptions: { where?, orderBy?, page?, pageSize?, includeDeleted? }
        - PaginatedResult: { data, total, page, pageSize, totalPages }
    - create(data: TInsert): Promise<TSelect>
    - createMany(data: TInsert[]): Promise<TSelect[]>
    - update(id: string, data: Partial<TInsert>): Promise<TSelect | null>
        - 自动更新 updated_at
    - delete(id: string): Promise<boolean>

2. SoftDeleteRepository 继承 BaseRepository：
    - 重写 delete → 设置 deleted_at 而非真删
    - 重写 findById/findMany → 默认过滤 deleted_at IS NULL
    - restore(id: string): Promise<TSelect | null>
    - forceDelete(id: string): Promise<boolean>

3. VersionedRepository 继承 SoftDeleteRepository：
    - 重写 update → WHERE id = ? AND version = ? 乐观锁
    - 更新时 version + 1
    - 冲突时抛出 OptimisticLockError（自定义错误类）

4. 事务支持：
    - withTransaction<T>(fn: (tx) => Promise<T>): Promise<T>
    - 事务内的操作复用同一个 tx 连接

二、具体 Repository packages/database/src/repository/：

- user.repository.ts extends SoftDeleteRepository
    - findByEmail(email), findByPhone(phone)
- product.repository.ts extends VersionedRepository
    - findBySlug(slug), findByCategoryId(categoryId, options)
- sku.repository.ts extends VersionedRepository
    - findByProductId(productId), findBySkuCode(code)
    - decrementStock(skuId, quantity) — 用 SQL: stock = stock - ? WHERE stock >= ? 原子操作防超卖
- order.repository.ts extends VersionedRepository
    - findByOrderNo(orderNo), findByUserId(userId, options)
- inventory-log.repository.ts extends BaseRepository（流水只追加）
    - findBySkuId(skuId, options)

三、统一导出 packages/database/src/repository/index.ts

四、数据库迁移体系：
- 在 packages/database/package.json 中添加脚本：
    - "db:generate": "drizzle-kit generate"
    - "db:migrate": "drizzle-kit migrate"
    - "db:studio": "drizzle-kit studio"
- 运行 db:generate 生成首次迁移文件到 drizzle/ 目录

五、更新 packages/database/src/index.ts：
- 导出 db client、全部 schema、全部 repository、类型定义

设计原则：
- Repository 方法全部返回 Promise，为读写分离预留（未来 readDb/writeDb 切换）
- decrementStock 必须用原子 SQL 不用 ORM 读改写
- 分页查询用 COUNT + LIMIT OFFSET，返回统一分页结构
- OptimisticLockError 继承自 @repo/shared 的自定义错误体系







