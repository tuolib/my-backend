# CLAUDE.md — 项目约定 & AI 协作指南

> **Claude Code CLI 会自动读取此文件。所有会话必须遵守以下约定。**

---

## 项目概述

企业级高并发电商平台（对标 Amazon / 阿里巴巴）  
Monorepo 架构，面向微服务演进设计。  
核心域：用户认证、商品管理、购物车、订单支付、库存并发控制。

## 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| Runtime | Bun | 高性能 JS/TS 运行时，内置 bundler/test runner |
| Web 框架 | Hono | 轻量、Edge-first、中间件体系完善 |
| ORM | Drizzle ORM | 类型安全、零运行时开销、SQL-first |
| 数据库 | PostgreSQL 16 | 主存储，JSONB + 全文搜索 + 行级锁 |
| 缓存/队列 | Redis 7 (Valkey) | 缓存 / 购物车 / 库存预扣 / 分布式锁 / 延迟队列 / 事件总线 |
| 反向代理 | Caddy | 自动 HTTPS、反向代理、负载均衡 |
| 容器化 | Docker + Compose | 本地开发 & 生产部署统一 |
| 校验 | Zod | 运行时类型校验，与 Drizzle schema 共享 |

## Monorepo 结构

```
apps/api-gateway/              # 唯一外部入口 :3000
services/user-service/         # 用户与认证域 :3001
services/product-service/      # 商品与库存域 :3002
services/cart-service/         # 购物车域 :3003
services/order-service/        # 订单与支付域 :3004
packages/shared/               # 通用工具、中间件、类型
packages/database/             # DB 连接、ORM schema、迁移、Lua 脚本
infra/                         # Docker / Caddy / PG / Redis 配置
docs/                          # 架构文档
```

## 编码规范

### 命名

- 文件名：`kebab-case.ts`（例：`error-handler.ts`）
- 类型/接口：`PascalCase`（例：`CreateOrderInput`）
- 函数/变量：`camelCase`（例：`findUserById`）
- 常量/枚举值：`UPPER_SNAKE_CASE`（例：`ERROR_CODES.STOCK_INSUFFICIENT`）
- 数据库表名：`snake_case`（例：`order_items`）
- 数据库列名：`snake_case`（例：`created_at`）
- Redis Key：`{service}:{resource}:{id}`（例：`stock:sku123`）

### 导入路径

始终使用 workspace 别名，禁止相对路径跨包引用：

```typescript
// ✅ 正确
import { AppError, signAccessToken, validate } from "@repo/shared";
import { db, redis, schema, luaScripts } from "@repo/database";

// ❌ 错误
import { AppError } from "../../packages/shared/src/errors";
```

### 导出规范

每个 package 通过 `src/index.ts` 统一导出，禁止深层路径导入：

```typescript
// ✅ 正确
import { AppError, NotFoundError, validate } from "@repo/shared";

// ❌ 错误
import { NotFoundError } from "@repo/shared/src/errors/http-errors";
```

### Service 分层结构

每个 service 内部统一分层：

```
services/{service-name}/src/
  ├── index.ts          # Hono app 入口
  ├── routes/           # 路由定义（仅参数校验 + 调用 service 层）
  │   ├── auth.ts
  │   └── user.ts
  ├── services/         # 业务逻辑（核心编排层）
  │   ├── auth.service.ts
  │   └── user.service.ts
  ├── repositories/     # 数据访问（DB/Redis 操作封装）
  │   └── user.repo.ts
  └── types/            # 本服务的 TS 类型定义
      └── index.ts
```

路由层不含业务逻辑，service 层不直接操作 DB。

### 错误处理

- 始终抛出 `AppError` 子类，禁止 `throw new Error()`
- 业务错误使用 `BizError`，携带 `errorCode` 枚举值
- HTTP 错误使用预定义类：`NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `ValidationError`
- 全局 `error-handler` 中间件统一捕获，转换为标准响应

### API 设计

- **全部使用 POST**，参数通过 JSON Body 传递
- 路由格式：`POST /api/v1/{domain}/{action}`
- 外部接口前缀 `/api/v1/`，内部接口前缀 `/internal/`
- 内部接口仅 Docker 内部网络可访问，外部不可达

### 响应格式

所有 API 统一返回：

```typescript
// 成功
{
  code: 200,
  success: true,
  data: T,
  message: "",
  traceId: string
}

// 失败
{
  code: number,            // HTTP 状态码
  success: false,
  message: string,         // 用户可见提示语
  data: null,
  meta: {
    code: string,          // 业务错误码，如 "USER_NOT_FOUND"
    message: string,       // 开发者可读描述
    details?: unknown      // 可选，校验错误详情等
  },
  traceId: string
}
```

### 环境变量

- 所有环境变量通过 `@repo/shared` 的 `config` 模块加载
- 使用 Zod schema 校验，启动时失败即报错
- 禁止在业务代码中直接 `process.env.XXX`

### 数据库

- Schema 定义在 `packages/database/src/schema/` 下
- 每个域一个 schema 文件（`users.ts`, `products.ts`, `orders.ts`）
- 所有表使用 PG schema 隔离（`user_service.users`, `product_service.products`, `order_service.orders`）
- 所有表必须有 `id`, `created_at`, `updated_at` 字段
- `id` 使用 nanoid（21位），不用自增 ID
- 时间字段统一 `timestamp with time zone`
- 软删除使用 `deleted_at` 字段
- 需要并发安全的表使用 `version` 字段（乐观锁）

### 库存操作

- 预扣/释放：通过 Redis Lua 脚本原子操作
- 确认：通过 PG 乐观锁（`WHERE version = :currentVersion`）
- 所有操作记录到 `stock_operations` 表（审计日志）
- 禁止直接 UPDATE skus SET stock = :value（必须走 DECRBY/INCRBY 或乐观锁）

### 幂等设计

- 订单创建、支付发起必须携带 `X-Idempotency-Key` header
- Gateway 层和 Service 层双重检查
- 幂等键存储在 Redis，TTL 24h

### 测试

- 测试框架：`bun:test`
- 测试文件：与源码同目录，命名 `*.test.ts`
- 单元测试：每个模块必须有
- 集成测试：每个 service 的 API 路由必须有
- 并发测试：库存扣减场景必须有
- 测试数据库使用独立实例，测试前后清理数据

### 中间件顺序

API Gateway 的中间件链按以下顺序挂载：

```
request-id → logger → cors → rate-limit → auth → idempotent → error-handler
```

## Claude Code 协作规则

### 分阶段开发

本项目按 `docs/architecture.md` 中定义的 Phase 0-8 路线图开发。  
每个阶段使用**独立的 Claude Code 会话**，避免长对话上下文退化。

### 每个会话的开始

1. 读取 `CLAUDE.md`（自动）
2. 读取 `docs/architecture.md` 中对应阶段的描述
3. 检查已完成阶段的代码，理解现有实现
4. 只做当前阶段的工作，不越界

### 接口文档同步

每当新增或修改 API 路由后，必须同步更新 `docs/api-reference.md` 中对应的接口文档。

### 代码生成要求

- 先写类型定义，再写实现
- 先写测试骨架，再写业务逻辑
- 每个文件头部注释说明用途
- 关键设计决策写在代码注释中
- 库存/支付等关键路径必须有并发安全注释

### 禁止事项

- 不要生成 `.env` 文件（使用 `.env.example`）
- 不要硬编码密钥、密码、端口号
- 不要引入未在技术栈中列出的依赖（需先讨论）
- 不要修改其他阶段的代码（除非修 bug）
- 不要直接 UPDATE 库存数值（必须走 Lua 脚本或乐观锁）
- 不要信任前端传来的金额（服务端必须重新计算）
