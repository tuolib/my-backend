# 企业级高并发电商架构 — 分段标准流程

> **对标**: Amazon / 阿里巴巴
> **技术栈**: Bun + Hono | PostgreSQL | Redis | Docker | Caddy
> **核心原则**: 分段设计、逐步交付、降低 token 消耗

---

## 全局架构总览（10 个阶段）

```
阶段 1  → 基础工程骨架
阶段 2  → 数据库建模与分层
阶段 3  → 核心商品域
阶段 4  → 用户与认证域
阶段 5  → 购物车与会话域
阶段 6  → 订单与支付域
阶段 7  → 库存与并发控制域
阶段 8  → 搜索、缓存与性能优化
阶段 9  → 基础设施与部署
阶段 10 → 可观测性、限流与容灾
```

---

## 阶段 1：基础工程骨架

### 目标
搭建 Monorepo 工程结构、统一配置、统一响应格式、统一错误处理，为后续所有业务域提供基座。

### 操作清单
- [ ] 初始化 Bun 项目，配置 `bunfig.toml`
- [ ] 搭建目录结构（按领域驱动 DDD 分层）
- [ ] 统一响应封装 `ApiResponse<T>`
- [ ] 统一错误处理中间件 `errorHandler`
- [ ] 统一请求日志中间件 `requestLogger`
- [ ] 配置管理（环境变量、多环境切换）
- [ ] 健康检查端点 `/health`
- [ ] Docker 基础镜像 + docker-compose 骨架
- [ ] Caddy 反向代理基础配置

### 提示词（复制给 AI）
```
你是一位资深后端架构师。请帮我用 Bun + Hono 搭建一个企业级电商项目的基础骨架。

要求：
1. 目录结构采用 DDD 分层：src/{domain}/{controller,service,repository,schema,types}
2. 公共层 src/shared/{middleware,utils,config,types}
3. 统一响应格式 { success, data, error, meta }
4. 全局错误处理中间件，区分业务异常和系统异常
5. 请求日志中间件（method, path, status, duration）
6. 环境配置从 .env 加载，用 zod 做 schema 校验
7. /health 端点返回服务状态
8. 提供 Dockerfile（基于 oven/bun）和 docker-compose.yml（含 postgres、redis、caddy）
9. Caddy 做反向代理，自动 HTTPS

只输出代码和关键文件，不要解释原理。
```

---

## 阶段 2：数据库建模与分层

### 目标
设计面向高并发电商的 PostgreSQL 数据模型，建立 Repository 模式，为读写分离预留接口。

### 操作清单
- [ ] 选择 ORM/Query Builder（Drizzle ORM 推荐）
- [ ] 设计核心表：users, products, skus, categories, orders, order_items, cart_items, payments, inventory
- [ ] 建立数据库迁移体系（drizzle-kit）
- [ ] 抽象 Repository 基类（CRUD 泛型）
- [ ] 数据库连接池配置（pg pool）
- [ ] 软删除、乐观锁（version 字段）、审计字段（created_at, updated_at, deleted_at）

### 提示词（复制给 AI）
```
你是一位数据库架构师。请为高并发电商系统设计 PostgreSQL 数据模型。

技术栈：Bun + Drizzle ORM + PostgreSQL

要求：
1. 设计以下核心表的 Drizzle schema：
   - users（含角色、状态）
   - categories（支持无限层级 - ltree 或 materialized path）
   - products（SPU 级）
   - skus（SKU 级，关联规格属性 JSONB）
   - inventory（独立库存表，含乐观锁 version 字段）
   - cart_items
   - orders + order_items
   - payments
2. 所有表包含 id(uuid), created_at, updated_at, deleted_at(软删除)
3. 合理使用索引（GIN 索引用于 JSONB，复合索引用于高频查询）
4. 提供一个泛型 BaseRepository<T> 封装常用 CRUD
5. 提供数据库连接池配置（最大连接数、空闲超时）
6. 提供 drizzle.config.ts 和迁移命令

只输出 schema 定义文件和 repository 代码。
```

---

## 阶段 3：核心商品域

### 目标
实现商品的 CRUD、SPU/SKU 模型、分类树、商品列表分页与过滤。

### 操作清单
- [ ] 商品 CRUD API（POST/GET/PUT/DELETE）
- [ ] SPU + SKU 双层模型
- [ ] 分类树查询（递归 CTE 或 ltree）
- [ ] 商品列表：游标分页 + 多条件过滤
- [ ] 商品详情：聚合 SKU、库存、评价数
- [ ] 输入校验（zod schema）
- [ ] Redis 缓存商品详情（Cache-Aside 模式）

### 提示词（复制给 AI）
```
你是一位电商后端开发专家。请实现商品域（Product Domain）的完整代码。

技术栈：Bun + Hono + Drizzle ORM + PostgreSQL + Redis

要求：
1. 商品采用 SPU/SKU 双层模型
   - SPU: 标题、描述、主图、分类ID、品牌、状态
   - SKU: 规格属性(JSONB)、价格、库存关联、图片、条形码
2. REST API：
   - POST   /api/v1/products         创建商品（含 SKU 批量创建）
   - GET    /api/v1/products          列表（游标分页，支持分类/价格区间/关键词过滤）
   - GET    /api/v1/products/:id      详情（聚合 SKU 列表、库存、评价统计）
   - PUT    /api/v1/products/:id      更新
   - DELETE /api/v1/products/:id      软删除
3. 分类树 API：GET /api/v1/categories/tree
4. 所有入参用 zod 校验
5. 商品详情走 Redis Cache-Aside：先查缓存 → 未命中查库 → 回写缓存（TTL 10 分钟）
6. controller → service → repository 三层分离

输出完整代码文件，按 src/domain/product/ 组织。
```

---

## 阶段 4：用户与认证域

### 目标
实现注册登录、JWT + Refresh Token、RBAC 权限控制、OAuth2 预留。

### 操作清单
- [ ] 注册（密码 argon2 哈希）
- [ ] 登录（签发 access_token + refresh_token）
- [ ] Token 刷新机制
- [ ] Redis 存储 refresh_token（支持主动吊销）
- [ ] 认证中间件 `authGuard`
- [ ] 角色中间件 `roleGuard(['admin', 'seller'])`
- [ ] 用户信息 CRUD

### 提示词（复制给 AI）
```
你是一位安全架构师。请实现用户与认证域。

技术栈：Bun + Hono + PostgreSQL + Redis

要求：
1. 注册：邮箱+密码，密码用 argon2 哈希，防重复注册
2. 登录：返回 { access_token (15min), refresh_token (7d) }
   - access_token 用 JWT (HS256)，payload 含 userId, role
   - refresh_token 存入 Redis（key: rt:{userId}:{tokenId}），支持多设备
3. POST /api/v1/auth/refresh 刷新 token（旋转刷新：旧 token 失效，签发新 token）
4. POST /api/v1/auth/logout 删除 Redis 中的 refresh_token
5. 认证中间件 authGuard：解析 Bearer token → 挂载 c.set('user', payload)
6. 角色中间件 roleGuard(roles: string[])：检查用户角色
7. GET /api/v1/users/me 获取当前用户信息
8. PUT /api/v1/users/me 更新个人资料

controller → service → repository 分层，输出完整代码。
```

---

## 阶段 5：购物车与会话域

### 目标
实现高性能购物车（Redis 为主存储）、合并策略、购物车快照。

### 操作清单
- [ ] 购物车数据结构设计（Redis Hash）
- [ ] 添加/更新/删除购物车项
- [ ] 查询购物车（关联商品实时价格和库存）
- [ ] 匿名购物车 → 登录后合并
- [ ] 购物车商品数量上限控制
- [ ] 结算预览（计算总价、运费、优惠）

### 提示词（复制给 AI）
```
你是一位高并发系统专家。请实现购物车域。

技术栈：Bun + Hono + Redis + PostgreSQL

要求：
1. 购物车存储在 Redis Hash：
   - key: cart:{userId}
   - field: skuId
   - value: JSON { quantity, addedAt, selected }
2. API：
   - POST   /api/v1/cart/items         添加商品（若已存在则累加数量）
   - PUT    /api/v1/cart/items/:skuId   更新数量/选中状态
   - DELETE /api/v1/cart/items/:skuId   删除单项
   - DELETE /api/v1/cart                清空购物车
   - GET    /api/v1/cart                查看购物车（实时关联商品名、价格、库存、图片）
   - POST   /api/v1/cart/checkout-preview  结算预览（选中项汇总）
3. 匿名用户用设备指纹 deviceId 代替 userId，登录后 POST /api/v1/cart/merge 合并
4. 单个购物车最多 99 项，单个 SKU 最多 999 件
5. 购物车 TTL 30 天，每次操作刷新 TTL
6. 查询购物车时用 pipeline 批量获取商品信息

输出完整代码。
```

---

## 阶段 6：订单与支付域

### 目标
实现订单创建（防重复提交）、状态机、支付集成预留、超时自动取消。

### 操作清单
- [ ] 订单号生成（雪花算法/时间戳+随机）
- [ ] 创建订单（幂等性：idempotency_key）
- [ ] 订单状态机（pending → paid → shipped → delivered → completed / cancelled / refunded）
- [ ] 库存预扣（Redis 原子操作 + DB 最终一致）
- [ ] 订单超时取消（Redis 过期事件 / 延迟队列）
- [ ] 订单列表与详情
- [ ] 支付回调 webhook 接口（预留）

### 提示词（复制给 AI）
```
你是一位交易系统架构师。请实现订单与支付域。

技术栈：Bun + Hono + PostgreSQL + Redis

要求：
1. 创建订单流程：
   a. 接收 idempotency_key 防重复提交（Redis SET NX, 10min TTL）
   b. 校验购物车选中项的库存（Redis 原子 DECRBY 预扣）
   c. 生成订单号：年月日+6位序列+2位随机（如 20240101000001AB）
   d. 事务写入 orders + order_items（含商品快照）
   e. 清除购物车已下单的项
   f. 设置 30 分钟超时取消（Redis SETEX order_timeout:{orderId}）
2. 订单状态机用枚举 + 合法转换 Map 实现，非法转换抛业务异常
3. API：
   - POST /api/v1/orders                创建订单
   - GET  /api/v1/orders                我的订单列表（分页+状态过滤）
   - GET  /api/v1/orders/:id            订单详情
   - POST /api/v1/orders/:id/cancel     取消订单（释放库存）
   - POST /api/v1/orders/:id/pay        模拟支付（状态 → paid）
   - POST /api/v1/webhooks/payment      支付回调（签名验证预留）
4. 超时取消：用 Redis keyspace notification 或定时任务扫描
5. 库存预扣失败要回滚已扣的所有 SKU

输出完整代码，含状态机实现。
```

---

## 阶段 7：库存与并发控制域

### 目标
实现高并发库存扣减、防超卖、秒杀场景支持。

### 操作清单
- [ ] Redis + Lua 原子扣减库存
- [ ] DB 乐观锁兜底（version 字段）
- [ ] 库存预扣 → 确认 → 释放三态
- [ ] 秒杀场景：令牌桶 + 库存预热
- [ ] 库存变更日志（inventory_logs 表）
- [ ] 库存对账任务（Redis vs DB）

### 提示词（复制给 AI）
```
你是一位高并发库存系统专家。请实现库存与并发控制域。

技术栈：Bun + Hono + PostgreSQL + Redis

要求：
1. Redis Lua 脚本实现原子库存操作：
   - deduct_stock.lua：检查库存 ≥ 扣减量，DECRBY 并返回结果
   - restore_stock.lua：释放库存 INCRBY
   - batch_deduct.lua：批量扣减多个 SKU（全成功或全失败）
2. DB 乐观锁兜底：UPDATE inventory SET stock = stock - ?, version = version + 1 WHERE sku_id = ? AND version = ? AND stock >= ?
3. 库存三态流程：
   - 预扣（下单时）→ Redis 扣减 + DB frozen_stock 增加
   - 确认（支付后）→ DB stock 扣减 + frozen_stock 减少
   - 释放（取消时）→ Redis 回补 + DB frozen_stock 减少
4. 库存变更日志 inventory_logs：sku_id, action(deduct/restore/confirm), quantity, order_id, before_stock, after_stock
5. 秒杀支持：
   - 库存预热：活动开始前将库存加载到 Redis
   - 请求令牌桶：限制每秒进入下单逻辑的请求数
6. 对账任务：比对 Redis stock 与 DB (stock - frozen_stock)，不一致时告警
7. API：
   - GET  /api/v1/inventory/:skuId       查询库存
   - PUT  /api/v1/inventory/:skuId       设置库存（管理员）
   - GET  /api/v1/inventory/:skuId/logs  库存变更日志

输出完整代码，含 Lua 脚本。
```

---

## 阶段 8：搜索、缓存与性能优化

### 目标
实现多级缓存、全文搜索、热点数据保护、接口性能优化。

### 操作清单
- [ ] PostgreSQL 全文搜索（tsvector + GIN 索引）
- [ ] 多级缓存策略：本地缓存(LRU) → Redis → DB
- [ ] 缓存穿透防护（布隆过滤器 / 空值缓存）
- [ ] 缓存雪崩防护（TTL 随机化 + 互斥锁重建）
- [ ] 热点 Key 检测与本地缓存
- [ ] 数据库查询优化（EXPLAIN ANALYZE、连接池调优）
- [ ] 接口响应压缩（Brotli/gzip）

### 提示词（复制给 AI）
```
你是一位性能优化专家。请实现搜索与缓存层。

技术栈：Bun + Hono + PostgreSQL + Redis

要求：
1. PostgreSQL 全文搜索：
   - products 表添加 search_vector 列（tsvector）
   - 触发器自动更新 search_vector（基于 title, description）
   - 支持中文分词（如 zhparser 或 pg_jieba，若不可用则用 simple 配置）
   - 搜索 API：GET /api/v1/search?q=关键词&category=&price_min=&price_max=&sort=relevance|price|sales&cursor=
2. 多级缓存封装 class CacheManager：
   - L1: 进程内 LRU 缓存（Map, 最大 1000 条, TTL 60s）
   - L2: Redis（TTL 10min）
   - L3: DB
   - get(key) 依次查询 L1 → L2 → L3，回填上层
3. 缓存穿透防护：不存在的 key 缓存空值（TTL 30s）
4. 缓存雪崩：TTL = baseTTL + random(0, 60s)
5. 缓存击穿：Redis 分布式锁（SETNX）+ 双重检查重建
6. 热点 Key 检测：LFU 计数器，超过阈值升级到 L1
7. 响应压缩中间件（Accept-Encoding → brotli > gzip）

输出 CacheManager 完整代码 + 搜索模块代码。
```

---

## 阶段 9：基础设施与部署

### 目标
实现生产级 Docker 编排、Caddy 配置、CI/CD 流水线、多环境管理。

### 操作清单
- [ ] 多阶段 Dockerfile（构建层 → 运行层）
- [ ] docker-compose.yml（app / postgres / redis / caddy）
- [ ] Caddy 配置（自动 HTTPS、反向代理、限流头）
- [ ] PostgreSQL 主从配置（docker-compose 扩展）
- [ ] Redis Sentinel 配置（高可用）
- [ ] 健康检查与自动重启策略
- [ ] GitHub Actions CI/CD 流水线
- [ ] 数据库备份脚本（pg_dump 定时任务）

### 提示词（复制给 AI）
```
你是一位 DevOps 架构师。请实现生产级基础设施配置。

技术栈：Docker + Caddy + PostgreSQL + Redis

要求：
1. 多阶段 Dockerfile：
   - 构建阶段：oven/bun → install → build
   - 运行阶段：oven/bun:slim → 仅复制产物 → 非 root 用户运行
   - 镜像大小目标 < 150MB
2. docker-compose.production.yml：
   - app: 2 replicas, healthcheck, restart: unless-stopped
   - postgres: 持久化 volume, 资源限制, healthcheck
   - redis: 持久化 (AOF), maxmemory 配置, healthcheck
   - caddy: 映射 80/443, 自动 HTTPS
3. Caddyfile：
   - 反向代理到 app:3000 (load balance: round_robin)
   - 静态资源缓存头
   - 安全头（HSTS, CSP, X-Frame-Options）
   - 请求限流 (rate_limit)
   - 访问日志
4. docker-compose.override.yml（开发环境覆盖：热重载、端口暴露、调试模式）
5. GitHub Actions：lint → test → build → push image → deploy
6. 数据库备份 cron 脚本（每日 pg_dump → 压缩 → 保留 7 天）
7. .env.example 模板

输出所有配置文件。
```

---

## 阶段 10：可观测性、限流与容灾

### 目标
实现请求限流、熔断降级、结构化日志、指标采集、告警机制。

### 操作清单
- [ ] 请求限流（令牌桶 / 滑动窗口，基于 IP 和用户）
- [ ] 熔断器模式（Circuit Breaker）
- [ ] 结构化日志（JSON 格式、请求追踪 traceId）
- [ ] Prometheus 指标暴露（/metrics）
- [ ] 关键业务指标（QPS、延迟 P99、错误率、库存扣减成功率）
- [ ] 优雅关闭（graceful shutdown）
- [ ] 数据库连接池监控

### 提示词（复制给 AI）
```
你是一位 SRE 专家。请实现可观测性与容灾层。

技术栈：Bun + Hono + Redis

要求：
1. 滑动窗口限流中间件：
   - Redis ZSET 实现（按 IP 或 userId）
   - 默认 100 req/min，可按路由配置不同阈值
   - 返回 429 时包含 Retry-After 头
2. 熔断器 class CircuitBreaker：
   - 状态：CLOSED → OPEN → HALF_OPEN
   - 配置：failureThreshold(5), resetTimeout(30s), halfOpenRequests(3)
   - 包装外部调用（数据库、第三方 API）
3. 结构化日志工具：
   - JSON 格式：{ timestamp, level, traceId, method, path, userId, duration, message }
   - traceId 通过中间件注入（X-Request-ID 或生成 UUID）
   - 日志级别：debug/info/warn/error
4. Prometheus 指标中间件：
   - http_requests_total (method, path, status)
   - http_request_duration_seconds (histogram, buckets)
   - active_connections (gauge)
   - 暴露 GET /metrics 端点
5. 优雅关闭：
   - 捕获 SIGTERM/SIGINT
   - 停止接收新请求
   - 等待进行中请求完成（超时 30s）
   - 关闭数据库连接池和 Redis 连接
   - 退出进程

输出完整代码。
```

---

## 阶段执行建议

### 执行顺序与依赖关系

```
阶段 1 (骨架)
  ↓
阶段 2 (数据库)
  ↓
阶段 3 (商品) ←──→ 阶段 4 (用户认证)  [可并行]
  ↓                    ↓
阶段 5 (购物车) ←── 依赖 3 + 4
  ↓
阶段 6 (订单) ←── 依赖 5
  ↓
阶段 7 (库存) ←── 依赖 6  [可与 6 合并]
  ↓
阶段 8 (搜索缓存) ←── 依赖 3
  ↓
阶段 9 (部署) ←── 所有业务域完成后
  ↓
阶段 10 (可观测性) ←── 贯穿全程，但集中在最后完善
```

### Token 消耗优化技巧

| 技巧 | 说明 |
|------|------|
| **分段提问** | 每次只给一个阶段的提示词，不要一次发全部 |
| **明确要求"只输出代码"** | 避免 AI 输出大段解释浪费 token |
| **引用已有代码** | 后续阶段提示词中说"复用阶段 1 的 ApiResponse 和错误处理" |
| **增量开发** | 说"在现有 src/domain/ 下新增 order 域"而非重新生成全部 |
| **指定文件列表** | "只输出以下文件：controller.ts, service.ts, repository.ts" |
| **拒绝重复** | "不要重复已有的中间件和工具函数代码" |

### 预估工作量

| 阶段 | 预估文件数 | 复杂度 | 建议对话轮数 |
|------|-----------|--------|-------------|
| 阶段 1 | 8-12 | ⭐⭐ | 1-2 轮 |
| 阶段 2 | 6-10 | ⭐⭐⭐ | 1-2 轮 |
| 阶段 3 | 8-12 | ⭐⭐⭐ | 2-3 轮 |
| 阶段 4 | 6-10 | ⭐⭐⭐ | 1-2 轮 |
| 阶段 5 | 5-8 | ⭐⭐ | 1-2 轮 |
| 阶段 6 | 10-15 | ⭐⭐⭐⭐⭐ | 3-4 轮 |
| 阶段 7 | 6-10 | ⭐⭐⭐⭐⭐ | 2-3 轮 |
| 阶段 8 | 5-8 | ⭐⭐⭐⭐ | 2-3 轮 |
| 阶段 9 | 8-12 | ⭐⭐⭐ | 1-2 轮 |
| 阶段 10 | 6-10 | ⭐⭐⭐⭐ | 2-3 轮 |

---

> **开始方式**：复制「阶段 1 的提示词」发给 AI，拿到代码后本地运行验证，再进入下一阶段。
