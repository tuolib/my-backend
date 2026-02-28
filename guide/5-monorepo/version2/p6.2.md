● Here's the Phase 6b Step 1 completion report:

  ---
Phase 6b — Step 1 完成报告

文件清单 (18 files)

services/order-service/src/
├── index.ts                              # Hono app 入口 :3004
├── middleware.ts                         # auth + idempotent 中间件实例
├── routes/
│   ├── order.ts                          # /api/v1/order/* (create/list/detail/cancel)
│   ├── admin.ts                          # /api/v1/admin/order/* (list/ship)
│   ├── payment.ts                        # /api/v1/payment/* (Step 2 占位)
│   └── internal.ts                       # /internal/order/* (预留)
├── services/
│   ├── order.service.ts                  # 核心编排：create/list/detail/cancel/adminList/ship
│   ├── product-client.ts                 # → product-service (SKU/库存预扣/释放/确认)
│   ├── cart-client.ts                    # → cart-service (清理购物车)
│   └── user-client.ts                    # → user-service (地址查询)
├── repositories/
│   ├── order.repo.ts                     # orders 表 CRUD + 乐观锁
│   ├── order-item.repo.ts               # order_items 表
│   └── order-address.repo.ts            # order_addresses 表
├── schemas/
│   └── order.schema.ts                   # Zod 校验 schema
├── state-machine/
│   └── order-status.ts                   # 状态枚举 + 流转表 + assertTransition
├── types/
│   └── index.ts                          # DTO 类型定义
└── __tests__/
├── order-state.test.ts               # 状态机单元测试 (18 tests)
└── order.test.ts                     # 集成测试 (15 tests)

+ services/user-service/src/routes/internal.ts  # 新增 /internal/user/address/detail

测试结果

33 pass, 0 fail, 95 expect() calls — 580ms

- 状态机单元测试 (18): 所有合法/非法流转、终态检测、assertTransition 错误码
- 集成测试 (15): 创建成功、幂等(409)、无效SKU(422)、无效地址(404)、无token(401)、列表、过滤、详情、404、管理
  端列表、发货拒绝(422)、取消成功、重复取消(422)、健康检查

订单创建全流程时序

Client → POST /api/v1/order/create (X-Idempotency-Key)
│
├─ 幂等中间件 → Redis order:idempotent:{key} CHECK
├─ 幂等检查 → DB orders.idempotency_key CHECK
├─ SKU 查询 → product-service /internal/product/sku/batch
├─ 金额计算 → 服务端 sum(sku.price × quantity)
├─ 地址查询 → user-service /internal/user/address/detail
├─ 库存预扣 → product-service /internal/stock/reserve (Redis Lua)
├─ PG 事务 → INSERT orders + order_items + order_addresses
│   └─ 失败？→ product-service /internal/stock/release (回滚)
├─ 超时 ZSET → Redis ZADD order:timeout
├─ 购物车清理 → cart-service /internal/cart/clear-items (best effort)
└─ 返回 { orderId, orderNo, payAmount, expiresAt }

关键设计决策

1. 双重幂等: 中间件层(Redis) + 服务层(DB idempotency_key)
2. 金额安全: 服务端从 SKU 实时价格计算，不信任前端
3. 库存补偿: PG事务失败时自动 releaseStock 回滚
4. 购物车容错: 清理失败只记日志，不阻塞订单
5. 乐观锁: 状态更新使用 WHERE version = :v
6. 地址快照: 独立存储，不 FK 到 user_addresses

下一步 (Phase 6b Step 2)

- 支付发起 + 模拟支付回调
- 超时自动取消（Redis ZRANGEBYSCORE 轮询）
- 并发下单压力测试

✻ Cooked for 15m 39s