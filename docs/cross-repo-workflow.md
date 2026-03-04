# 大模块开发：前后端双仓库 Claude Code 工作流

以"订单模块"为例。

---

## 第一步：后端仓库先行

在后端仓库启动 Claude Code：

**提问示例：**

> "按 docs/architecture.md 的 Phase X，开发订单模块的后端 API。完成后帮我整理一份 API 接口文档，列出所有接口的路径、请求参数、响应结构。"

**关键：让后端会话输出一份接口清单**，大致像这样：

```
POST /api/v1/order/create
Body: { skuId, quantity, addressId, idempotencyKey }
Response: { orderId, status, totalAmount }

POST /api/v1/order/detail
Body: { orderId }
Response: { orderId, items, status, payment... }
```

---

## 第二步：把接口清单带到前端仓库

在前端仓库启动另一个 Claude Code：

**提问示例：**

> "我在开发电商 H5 的订单模块，后端 API 如下：
> （粘贴接口清单）
> 请帮我开发：订单确认页、支付页、订单列表页、订单详情页。"

---

## 第三步：联调阶段的问题回传

前端开发中遇到接口问题，回到后端会话：

> "前端调用 `/api/v1/order/create` 时，需要返回预估配送时间字段，请在响应里加上 `estimatedDelivery`。"

后端改完后，再回到前端会话：

> "后端 order/create 接口已更新，响应新增了 `estimatedDelivery` 字段，请在订单确认页展示。"

---

## 总结：三条原则

| 原则 | 说明 |
|------|------|
| **后端先行** | 先定义好 API，再做前端，避免反复改 |
| **接口文档是桥梁** | 后端输出 → 粘贴给前端会话，这是两个会话的唯一交接物 |
| **变更同步简洁** | 只说"改了什么、加了什么"，不需要重复整个上下文 |
