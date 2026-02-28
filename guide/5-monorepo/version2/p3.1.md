● 完成报告

新增/修改的文件清单

┌────────────────────────────────────────────┬──────┬──────────────────────────────────────────────────────────────┐
│                    文件                    │ 操作 │                             说明                             │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ packages/database/src/schema/_common.ts    │ 修改 │ uuid → varchar(21) nanoid, version default 0                 │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ packages/database/src/schema/users.ts      │ 重写 │ pgSchema('user_service'), 新增 user_addresses,               │
│                                            │      │ refresh_tokens                                               │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ packages/database/src/schema/products.ts   │ 重写 │ pgSchema('product_service'), 新增 product_categories,        │
│                                            │      │ product_images；合并原 skus.ts categories.ts                 │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ packages/database/src/schema/orders.ts     │ 重写 │ pgSchema('order_service'), 新增 order_addresses,             │
│                                            │      │ stock_operations；合并原 payments.ts → payment_records       │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ packages/database/src/schema/index.ts      │ 重写 │ 导出 3 个域全部表 + 类型                                     │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ packages/database/src/client.ts            │ 重写 │ getConfig() 替代 RuntimeConfig 直接引用                      │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ packages/database/src/redis.ts             │ 重写 │ getConfig() + createRedis() 工厂 + lazyConnect               │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ packages/database/src/migrate.ts           │ 重写 │ 自动创建 3 个 PG schema + 迁移执行                           │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ packages/database/src/index.ts             │ 重写 │ 移除 repository 导出                                         │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ packages/database/drizzle.config.ts        │ 修改 │ out → src/migrations                                         │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ packages/database/package.json             │ 修改 │ 移除 drizzle-zod，新增 generate/migrate/seed scripts         │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ src/migrations/0000_fluffy_blue_shield.sql │ 新增 │ Drizzle 生成的完整 DDL（13 表）                              │
├────────────────────────────────────────────┼──────┼──────────────────────────────────────────────────────────────┤
│ src/migrations/0001_add-custom-indexes.sql │ 新增 │ GIN / 全文搜索 / 条件索引                                    │
└────────────────────────────────────────────┴──────┴──────────────────────────────────────────────────────────────┘

删除的文件： skus.ts, categories.ts, cart_items.ts, order_items.ts, payments.ts, inventory_logs.ts, repository/ 目录,
drizzle/ 旧迁移目录

迁移执行结果

3 个 PG Schema： user_service, product_service, order_service

13 张表：
- user_service: users, user_addresses, refresh_tokens
- product_service: categories, products, product_categories, product_images, skus
- order_service: orders, order_items, order_addresses, payment_records, stock_operations

56 个索引 (含 PK、UNIQUE、GIN、全文搜索、条件索引)

类型验证结果

所有 13 张表 $inferSelect / $inferInsert 类型验证通过。

下一步预告（Phase 3 Step 2）

- Redis Lua 脚本（库存预扣/释放/确认）
- 种子数据（categories, products, skus 测试数据）
- Redis 库存初始化（从 DB 同步到 Redis