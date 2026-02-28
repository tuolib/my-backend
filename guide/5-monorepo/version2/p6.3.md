● ---
Phase 6b 完成报告 — services/order-service 订单与支付域

测试汇总

┌──────────────────────────┬────────┬──────────────────┬───────┐
│         测试文件         │ 测试数 │       结果       │ 耗时  │
├──────────────────────────┼────────┼──────────────────┼───────┤
│ order-state.test.ts      │ 18     │ 全部通过         │ 91ms  │
├──────────────────────────┼────────┼──────────────────┼───────┤
│ order.test.ts            │ 15     │ 全部通过         │ 524ms │
├──────────────────────────┼────────┼──────────────────┼───────┤
│ payment.test.ts          │ 9      │ 全部通过         │ 568ms │
├──────────────────────────┼────────┼──────────────────┼───────┤
│ timeout.test.ts          │ 3      │ 全部通过         │ 541ms │
├──────────────────────────┼────────┼──────────────────┼───────┤
│ order-concurrent.test.ts │ 3      │ 全部通过         │ 710ms │
├──────────────────────────┼────────┼──────────────────┼───────┤
│ full-flow.test.ts        │ 9      │ 全部通过         │ 548ms │
├──────────────────────────┼────────┼──────────────────┼───────┤
│ 合计                     │ 57     │ 57 pass / 0 fail │       │
└──────────────────────────┴────────┴──────────────────┴───────┘

并发测试数据

┌──────────────────────────────────────┬──────────┬────────────────────────────────────────────────────┐
│                 场景                 │  并发数  │                        结果                        │
├──────────────────────────────────────┼──────────┼────────────────────────────────────────────────────┤
│ 场景 1：同一 SKU 并发下单 — 库存安全 │ 20       │ 20 成功，库存 73→53，扣减量=20，无超卖             │
├──────────────────────────────────────┼──────────┼────────────────────────────────────────────────────┤
│ 场景 2：同一幂等 key 并发提交        │ 10       │ 10×200（幂等竞争优雅降级），唯一订单=1，库存扣减=1 │
├──────────────────────────────────────┼──────────┼────────────────────────────────────────────────────┤
│ 场景 3：下单+取消并发 — 库存最终一致 │ 1+cancel │ 库存 52→50→52 完全恢复                             │
└──────────────────────────────────────┴──────────┴────────────────────────────────────────────────────┘

超时取消测试

- 超时 pending 订单被自动取消 → cancelled，cancelReason=支付超时自动取消
- 已支付订单不被误取消 → 状态仍为 paid，ZSET 条目被清理
- 已用户取消的订单不重复处理 → cancelReason 保持 用户主动取消

E2E 全流程

注册 → 地址 → 浏览商品 → 加购物车 → 创建订单 → 发起支付 → 支付回调 → 管理员发货 → 数据一致性验证 — 9
步全部通过，45 个 expect 断言。

文件清单（26 个文件，3111 行）

services/order-service/src/
├── index.ts                          # Hono 入口 + 超时检查器 + 优雅停机
├── middleware.ts                     # auth + idempotent 中间件实例
├── state-machine/
│   └── order-status.ts               # 状态枚举 + 转移表 + assertTransition
├── types/
│   └── index.ts                      # 全部 DTO 类型（订单 + 支付 + 跨服务）
├── schemas/
│   ├── order.schema.ts               # Zod v4 校验（create/list/detail/cancel/ship）
│   └── payment.schema.ts             # Zod v4 校验（create/notify/query）
├── repositories/
│   ├── order.repo.ts                 # 订单 CRUD + 乐观锁更新 + 超时查询
│   ├── order-item.repo.ts            # 订单商品快照 CRUD
│   ├── order-address.repo.ts         # 订单地址快照 CRUD
│   └── payment.repo.ts              # 支付记录 CRUD + transactionId 幂等
├── services/
│   ├── order.service.ts              # 核心编排（创建9步流程 + 查询 + 取消 + 发货）
│   ├── payment.service.ts            # 支付发起 + 回调处理 + 状态查询
│   ├── timeout.service.ts            # ZSET 轮询超时自动取消
│   ├── product-client.ts             # 跨服务：SKU 批量查询 / 库存预扣释放确认
│   ├── cart-client.ts                # 跨服务：购物车清理（best effort）
│   └── user-client.ts               # 跨服务：地址详情获取
├── routes/
│   ├── order.ts                      # /api/v1/order/* (create/list/detail/cancel)
│   ├── payment.ts                    # /api/v1/payment/* (create/notify/query)
│   ├── admin.ts                      # /api/v1/admin/order/* (list/ship)
│   └── internal.ts                   # /internal/order/* (预留)
└── __tests__/
├── order-state.test.ts           # 状态机单元测试 (18)
├── order.test.ts                 # 订单集成测试 (15)
├── payment.test.ts               # 支付测试 (9)
├── timeout.test.ts               # 超时取消测试 (3)
├── order-concurrent.test.ts      # 并发压力测试 (3)
└── full-flow.test.ts             # E2E 全流程测试 (9)

关键设计决策

1. 服务端价格计算 — 不信任前端传入价格，通过 fetchSkuBatch 获取实时 SKU 价格并在服务端计算
2. 库存预扣-补偿模式 — reserve 成功后若 PG 事务失败，catch 块自动 releaseStock
3. 双重幂等 — Redis 中间件层（409）+ PG unique constraint 层（catch 23505 返回原订单）
4. 乐观锁 — updateStatus 使用 WHERE version = :v，并发更新安全
5. 超时 ZSET — ZADD order:timeout score=expiresAt + 10s 轮询 ZRANGEBYSCORE
6. 快照隔离 — order_items 和 order_addresses 存储下单时的快照，不 FK 到源表

Phase 7 预览

下一阶段：apps/api-gateway — 唯一外部入口，反向代理到各服务，统一认证、限流、CORS、幂等中间件。

✻ Sautéed for 12m 35s