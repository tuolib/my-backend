
# step 1

┌──────────────────────────┬────────────────────────────────────────┐
│           命令           │                  说明                  │
├──────────────────────────┼────────────────────────────────────────┤
│ bun run docker:dev       │ 本地开发环境启动（前台运行，含 build） │
├──────────────────────────┼────────────────────────────────────────┤
│ bun run docker:dev:down  │ 停止本地开发环境                       │
├──────────────────────────┼────────────────────────────────────────┤
│ bun run docker:prod      │ 生产环境启动（后台运行，含 Caddy）     │
├──────────────────────────┼────────────────────────────────────────┤
│ bun run docker:prod:down │ 停止生产环境                           │
├──────────────────────────┼────────────────────────────────────────┤
│ bun run docker:prod:logs │ 查看生产环境日志                       │
└──────────────────────────┴────────────────────────────────────────┘

# stop 2

● 零类型错误。所有文件创建完成，以下是结构总结：

创建的文件

packages/database/src/schema/
├── _common.ts      — baseColumns / softDelete / optimisticLock 工厂函数
├── users.ts        — users 表 + user_status 枚举 + Zod schemas
├── categories.ts   — categories 表 + 自关联 relations (无限层级) + Zod schemas
├── products.ts     — products 表 + product_status 枚举 + relations + Zod schemas
├── skus.ts         — skus 表 + CHECK(stock>=0) + relations + Zod schemas
└── index.ts        — 统一导出所有表、枚举、relations、Zod schemas
 
设计要点

┌──────────────┬──────────────────────────────────────────────────────────┐
│     特性     │                           实现                           │
├──────────────┼──────────────────────────────────────────────────────────┤
│ SPU/SKU 分离 │ products 为 SPU，skus 持有价格/库存                      │
├──────────────┼──────────────────────────────────────────────────────────┤
│ 金额精度     │ numeric(12,2) 不用 float                                 │
├──────────────┼──────────────────────────────────────────────────────────┤
│ 无限层级分类 │ parentId 自引用 + path materialized path 字段            │
├──────────────┼──────────────────────────────────────────────────────────┤
│ 乐观锁       │ products/skus 含 version 字段                            │
├──────────────┼──────────────────────────────────────────────────────────┤
│ 软删除       │ users/categories/products/skus 均含 deleted_at           │
├──────────────┼──────────────────────────────────────────────────────────┤
│ 库存安全     │ CHECK (stock >= 0) 约束，数据库级别防止超卖              │
├──────────────┼──────────────────────────────────────────────────────────┤
│ 时区         │ 所有时间字段 timestamp with time zone                    │
├──────────────┼──────────────────────────────────────────────────────────┤
│ Relations    │ category↔parent/children, product↔category, product↔skus │
└──────────────┴──────────────────────────────────────────────────────────┘

修改的文件

- client.ts — drizzle(sql, { schema }) 注入 schema，启用 relations 查询支持
- package.json — 新增 drizzle-zod 依赖



# step 3

New Files (5)

┌───────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│       File        │                                         Description                                          │
├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│ cart_items.ts     │ 购物车表 — baseColumns only (无软删除), unique(user_id, sku_id), CHECK quantity > 0          │
├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│ orders.ts         │ 订单主表 — baseColumns + softDelete + optimisticLock, orderStatusEnum (8 states), 4          │
│                   │ 个金额字段 numeric(12,2), addressSnapshot jsonb, 4 个时间戳, cancel_reason, 4 个索引         │
├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│ order_items.ts    │ 订单明细 — baseColumns, productSnapshot jsonb, price/quantity/subtotal, CHECK quantity > 0   │
├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│ payments.ts       │ 支付记录 — paymentMethodEnum (4 methods), paymentStatusEnum (4 states),                      │
│                   │ providerTransactionId, rawResponse jsonb                                                     │
├───────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│ inventory_logs.ts │ 库存流水 — baseColumns only (只追加不修改), inventoryLogTypeEnum (6 types), changeQuantity   │
│                   │ 可正可负, beforeStock/afterStock 快照, referenceType + referenceId 多态关联                  │
└───────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘

Modified Files (3)

┌──────────┬────────────────────────────────────────────────────────────────────────┐
│   File   │                                 Change                                 │
├──────────┼────────────────────────────────────────────────────────────────────────┤
│ users.ts │ 添加 usersRelations — hasMany orders, cartItems                        │
├──────────┼────────────────────────────────────────────────────────────────────────┤
│ skus.ts  │ 扩展 skusRelations — 新增 hasMany cartItems, orderItems, inventoryLogs │
├──────────┼────────────────────────────────────────────────────────────────────────┤
│ index.ts │ 统一导出所有新表、relations、enums、zod schemas                        │
└──────────┴────────────────────────────────────────────────────────────────────────┘

Relations 完整映射

- user → hasMany orders, cartItems
- order → hasMany orderItems, payments; belongsTo user
- orderItem → belongsTo order, sku
- payment → belongsTo order
- cartItem → belongsTo user, sku
- sku → hasMany cartItems, orderItems, inventoryLogs
- inventoryLog → belongsTo sku



# step 4

完成总结

一、Repository 基类体系 (packages/database/src/repository/base.repository.ts)

┌──────────────────────┬──────────────────────┬────────────────────────────────────────────────────────────────────┐
│          类          │         继承         │                              核心能力                              │
├──────────────────────┼──────────────────────┼────────────────────────────────────────────────────────────────────┤
│ BaseRepository       │ —                    │ findById, findMany(分页), create, createMany, update, delete,      │
│                      │                      │ withTransaction                                                    │
├──────────────────────┼──────────────────────┼────────────────────────────────────────────────────────────────────┤
│ SoftDeleteRepository │ BaseRepository       │ 重写 delete→设置 deleted_at; findById/findMany 默认过滤已删除;     │
│                      │                      │ restore, forceDelete                                               │
├──────────────────────┼──────────────────────┼────────────────────────────────────────────────────────────────────┤
│ VersionedRepository  │ SoftDeleteRepository │ 重写 update→WHERE version = ? 乐观锁; 冲突抛 OptimisticLockError   │
└──────────────────────┴──────────────────────┴────────────────────────────────────────────────────────────────────┘

二、具体 Repository

┌────────────────────────┬──────────────────────┬───────────────────────────────────────────────────────────────┐
│       Repository       │         继承         │                           专属方法                            │
├────────────────────────┼──────────────────────┼───────────────────────────────────────────────────────────────┤
│ UserRepository         │ SoftDeleteRepository │ findByEmail, findByPhone                                      │
├────────────────────────┼──────────────────────┼───────────────────────────────────────────────────────────────┤
│ ProductRepository      │ VersionedRepository  │ findBySlug, findByCategoryId                                  │
├────────────────────────┼──────────────────────┼───────────────────────────────────────────────────────────────┤
│ SkuRepository          │ VersionedRepository  │ findByProductId, findBySkuCode, decrementStock(原子SQL防超卖) │
├────────────────────────┼──────────────────────┼───────────────────────────────────────────────────────────────┤
│ OrderRepository        │ VersionedRepository  │ findByOrderNo, findByUserId                                   │
├────────────────────────┼──────────────────────┼───────────────────────────────────────────────────────────────┤
│ InventoryLogRepository │ BaseRepository       │ findBySkuId（只追加，无删除）                                 │
└────────────────────────┴──────────────────────┴───────────────────────────────────────────────────────────────┘

三、错误体系扩展 (@repo/shared/errors)

- 新增 OPTIMISTIC_LOCK_CONFLICT 错误码
- 新增 OptimisticLockError 类 (409 Conflict)

四、Package.json 脚本

"db:generate": "drizzle-kit generate"
"db:migrate":  "drizzle-kit migrate"
"db:studio":   "drizzle-kit studio"

五、首次迁移

- drizzle/0000_ordinary_chameleon.sql — 9 表 + 6 enum + 28 索引 + 9 FK + 3 CHECK 约束

六、导出更新

- packages/database/src/index.ts — 统一导出 client、schema、repository
- package.json 新增 ./repository 子路径导出


