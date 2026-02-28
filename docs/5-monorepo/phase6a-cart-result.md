● Phase 6a 完成报告 ✅

全部测试通过

22 pass | 0 fail | 60 expect() calls | 3 files | 1282ms

文件清单 + 目录树

services/cart-service/src/
├── index.ts                    # Hono app 入口 :3003
├── middleware.ts               # Auth middleware 实例
├── routes/
│   ├── cart.ts                 # /api/v1/cart/* 路由（7 个端点）
│   └── internal.ts            # /internal/cart/clear-items
├── services/
│   ├── cart.service.ts         #
购物车核心逻辑（add/list/update/remove/clear/select/checkoutPreview/clearItems）
│   └── product-client.ts      # Product Service HTTP 客户端
├── schemas/
│   └── cart.schema.ts          # Zod 校验 schema
├── types/
│   └── index.ts               # TS 类型定义
└── __tests__/
├── cart.test.ts            # 14 个测试：CRUD + 上限 + 参数校验
├── checkout.test.ts        # 3 个测试：结算预览 + 金额计算
└── internal.test.ts        # 3 个测试：清理接口 + 幂等

API 端点

┌────────────────────────────────────┬──────────────────────────────────────┬──────┐
│                路由                │                 说明                 │ 认证 │
├────────────────────────────────────┼──────────────────────────────────────┼──────┤
│ POST /api/v1/cart/add              │ 添加商品（累加数量，刷新快照）       │ JWT  │
├────────────────────────────────────┼──────────────────────────────────────┼──────┤
│ POST /api/v1/cart/list             │ 购物车列表（实时价格/库存/状态对比） │ JWT  │
├────────────────────────────────────┼──────────────────────────────────────┼──────┤
│ POST /api/v1/cart/update           │ 更新数量（0=删除）                   │ JWT  │
├────────────────────────────────────┼──────────────────────────────────────┼──────┤
│ POST /api/v1/cart/remove           │ 批量删除                             │ JWT  │
├────────────────────────────────────┼──────────────────────────────────────┼──────┤
│ POST /api/v1/cart/clear            │ 清空购物车                           │ JWT  │
├────────────────────────────────────┼──────────────────────────────────────┼──────┤
│ POST /api/v1/cart/select           │ 选择/取消选择                        │ JWT  │
├────────────────────────────────────┼──────────────────────────────────────┼──────┤
│ POST /api/v1/cart/checkout/preview │ 结算预览（价格/库存校验+金额计算）   │ JWT  │
├────────────────────────────────────┼──────────────────────────────────────┼──────┤
│ POST /internal/cart/clear-items    │ 下单后清理 SKU（幂等）               │ 内部 │
└────────────────────────────────────┴──────────────────────────────────────┴──────┘

Redis 购物车数据结构

Key:   cart:{userId}    (Hash, TTL 30d)
Field: {skuId}
Value: {
"skuId": "xxx",
"quantity": 2,
"selected": true,
"addedAt": "2026-02-28T...",
"snapshot": {
"productId": "xxx",
"productTitle": "商品名",
"skuAttrs": {"颜色":"黑色"},
"price": "299.00",
"imageUrl": "https://..."
}
}

关键设计

- 纯 Redis 存储，不操作 PG
- add 时记录价格快照，list/preview 时对比实时价格
- 结算预览不扣库存，只校验+计算（用实时价格）
- canCheckout = 无下架 + 无库存不足（价格变动只是 warning）
- 购物车上限 50 SKU，每次写操作刷新 TTL
- /internal/cart/clear-items 幂等

Phase 6b 预告

services/order-service — 订单创建 / 状态机 / 支付 / 超时取消 / 库存预扣确认

✻ Cogitated for 7m 0s