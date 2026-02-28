# 阶段内标准操作流程 — 如何高效问 AI

> 核心思路：**先拿清单 → 再逐个生成 → 最后组装验证**
> 一个阶段分 4 步走，每步都有固定的提问模板。

---

## 总览：每个阶段的 4 步法

```
┌─────────────────────────────────────────────────┐
│  Step 1  📋 要清单    （1 轮对话，~200 token）    │
│  "这个阶段要生成哪些文件？列出文件树和每个文件职责" │
├─────────────────────────────────────────────────┤
│  Step 2  🔨 逐文件生成 （每轮 1-2 个文件）        │
│  "请生成 xxx.ts，只输出这一个文件的完整代码"       │
├─────────────────────────────────────────────────┤
│  Step 3  🔗 组装联调   （1 轮对话）               │
│  "以下文件已完成，请生成 index.ts 入口和路由注册"  │
├─────────────────────────────────────────────────┤
│  Step 4  ✅ 验证修复   （按需，0-2 轮）           │
│  "运行报错：[粘贴错误]，请修复"                    │
└─────────────────────────────────────────────────┘
```

---

## Step 1：要清单（每个阶段必做的第一步）

### 目的
让 AI 先规划，不写代码。拿到文件清单后你心里有数，也能控制后续每轮的粒度。

### 固定提示词模板
```
我正在做「阶段 X：{阶段名称}」。

技术栈：Bun + Hono + Drizzle ORM + PostgreSQL + Redis
项目结构：DDD 分层 src/{domain}/{controller,service,repository,schema,types}

请不要写代码。只做以下事情：
1. 列出这个阶段需要创建/修改的所有文件（完整路径）
2. 每个文件用一句话说明职责
3. 标注文件之间的依赖顺序（先写哪个后写哪个）
4. 标注哪些文件依赖前面阶段的已有代码

用表格输出，格式：| 序号 | 文件路径 | 职责 | 依赖 |
```

### 你会得到什么
一张类似这样的表：

| 序号 | 文件路径 | 职责 | 依赖 |
|------|---------|------|------|
| 1 | src/domain/product/types.ts | 商品相关 TS 类型定义 | 无 |
| 2 | src/domain/product/schema.ts | zod 校验 schema | types.ts |
| 3 | src/domain/product/repository.ts | 数据库操作层 | 阶段 2 的 BaseRepository |
| 4 | src/domain/product/service.ts | 业务逻辑层 | repository.ts |
| 5 | src/domain/product/controller.ts | 路由与请求处理 | service.ts, schema.ts |
| 6 | src/domain/product/index.ts | 导出 & 路由注册 | controller.ts |

**Token 消耗：约 200-400**（因为没有代码输出）

---

## Step 2：逐文件生成（核心步骤，循环执行）

### 目的
按依赖顺序，每次只让 AI 生成 1-2 个文件，保证代码质量且不超上下文。

### 固定提示词模板
```
阶段 X：{阶段名称}
当前任务：生成第 {N} 个文件

文件路径：{从 Step 1 表格拿到的路径}
文件职责：{从 Step 1 表格拿到的职责描述}

已有上下文（不要重复生成这些）：
- src/shared/types/response.ts → 统一响应 ApiResponse<T>
- src/shared/middleware/error-handler.ts → 全局错误处理
- src/shared/config/env.ts → 环境配置
- {前面步骤已生成的文件，列出文件名和关键导出}

要求：
1. 只输出这一个文件的完整代码
2. 导入路径使用相对路径
3. 不要输出解释，不要输出其他文件
```

### 关键技巧

**技巧 1：带上"已有上下文摘要"而不是完整代码**
```
❌ 错误做法：把之前所有文件的完整代码粘贴进去（爆 token）
✅ 正确做法：只列出文件名 + 关键导出名

已有上下文：
- types.ts 导出：Product, Sku, CreateProductInput, ProductFilter
- schema.ts 导出：createProductSchema, updateProductSchema, productQuerySchema
- repository.ts 导出：class ProductRepository { findById, findMany, create, update, softDelete }
```

**技巧 2：复杂文件可以分段要求**
```
service.ts 较大，请先只实现以下方法：
- createProduct（含 SKU 批量创建）
- getProductDetail（含缓存逻辑）

剩余方法我下一轮再要。
```

**技巧 3：给明确约束避免 AI 发散**
```
约束：
- 错误处理复用 shared/utils/app-error.ts 的 AppError 类
- Redis 操作复用 shared/utils/redis.ts 的 redis 实例
- 不要自己封装新的响应格式，用已有的 ApiResponse
```

### 每轮 Token 消耗：约 500-1500（视文件复杂度）

---

## Step 3：组装联调（生成胶水代码）

### 目的
所有独立文件生成完后，让 AI 生成入口文件和路由注册代码把它们串起来。

### 固定提示词模板
```
阶段 X 的所有文件已生成完毕，文件清单如下：

1. src/domain/product/types.ts — 类型定义
2. src/domain/product/schema.ts — zod 校验
3. src/domain/product/repository.ts — 数据库操作
4. src/domain/product/service.ts — 业务逻辑
5. src/domain/product/controller.ts — 路由处理

请生成：
1. src/domain/product/index.ts — 导出该域的 Hono 路由实例
2. 在 src/app.ts 中注册该域路由的代码片段（只输出需要新增的行）

不要重复输出已有文件。
```

### Token 消耗：约 300-500

---

## Step 4：验证修复（按需执行）

### 目的
本地跑起来后，如果有报错，精准定位让 AI 修复。

### 固定提示词模板
```
阶段 X 本地运行报错，请修复。

报错信息：
{只粘贴关键错误，不要粘贴整个日志}

相关文件（只贴出问题文件的关键部分）：
文件：src/domain/product/service.ts
行号：45-60
```typescript
{只粘贴出错附近的代码片段，不要全文件}
```

请只输出需要修改的部分，用 diff 格式：
- 旧代码
+ 新代码
```

### 关键技巧
```
❌ 错误做法："帮我看看哪里有问题" + 粘贴 5 个完整文件
✅ 正确做法：精确到文件名、行号、错误信息，只贴相关片段
```

### Token 消耗：约 200-800

---

## 实战示例：阶段 3（商品域）的完整操作流程

### 第 1 轮：要清单
```
我正在做「阶段 3：核心商品域」。

技术栈：Bun + Hono + Drizzle ORM + PostgreSQL + Redis
已完成：阶段 1（工程骨架）、阶段 2（数据库建模）

请不要写代码。列出这个阶段需要创建的所有文件、职责、依赖顺序。
用表格输出。
```
→ 得到 6-8 个文件的清单

### 第 2 轮：生成 types.ts + schema.ts
```
请生成以下 2 个文件，只输出代码：

1. src/domain/product/types.ts
   - Product, Sku, CreateProductInput, UpdateProductInput, ProductFilter, ProductDetail 类型

2. src/domain/product/schema.ts
   - 用 zod 定义 createProductSchema, updateProductSchema, productQuerySchema

约束：价格用 number（分为单位），状态枚举 draft/active/archived
```

### 第 3 轮：生成 repository.ts
```
请生成 src/domain/product/repository.ts

已有上下文：
- 阶段 2 的 BaseRepository<T>（提供 findById, create, update, softDelete）
- 阶段 2 的 Drizzle schema：products 表, skus 表, categories 表
- types.ts 导出：Product, Sku, CreateProductInput, ProductFilter

要求：
- 继承 BaseRepository
- 新增方法：findManyWithFilter(filter: ProductFilter), findDetailById(id), findCategoryTree()
- findManyWithFilter 支持游标分页、分类过滤、价格区间、关键词模糊搜索
- findDetailById 聚合 SKU 列表和库存数量

只输出这一个文件。
```

### 第 4 轮：生成 service.ts
```
请生成 src/domain/product/service.ts

已有上下文：
- repository.ts 导出：class ProductRepository { findManyWithFilter, findDetailById, findCategoryTree, create, update, softDelete }
- shared/utils/redis.ts 导出：redis 实例（ioredis）
- shared/utils/app-error.ts 导出：AppError 类

要求：
- createProduct：事务创建 SPU + 批量 SKU
- getProductDetail：Cache-Aside（Redis key product:{id}，TTL 600s）
- getProductList：直接调 repository
- updateProduct：更新后删除缓存
- deleteProduct：软删除后删除缓存
- getCategoryTree：缓存 1 小时

只输出这一个文件。
```

### 第 5 轮：生成 controller.ts + 组装
```
请生成以下 2 个文件：

1. src/domain/product/controller.ts
   已有上下文：
   - service.ts 导出所有方法
   - schema.ts 导出所有 zod schema
   - shared/middleware/auth.ts 导出 authGuard, roleGuard
   路由：POST/GET/PUT/DELETE /api/v1/products，GET /api/v1/categories/tree

2. src/domain/product/index.ts
   导出 Hono 路由实例 + 在 app.ts 中需要新增的注册代码
```

### 第 6 轮（如需）：修复报错
```
运行 bun run dev 报错：

TypeError: ProductRepository is not a constructor
  at src/domain/product/service.ts:12:22

service.ts 第 12 行：
const repo = new ProductRepository(db);

repository.ts 导出方式：
export class ProductRepository extends BaseRepository<Product> { ... }

请修复。
```

---

## Token 消耗对比

| 方式 | 预估 Token | 质量 |
|------|-----------|------|
| ❌ 一次性发整个阶段的大 prompt | 8,000 - 15,000 | 容易遗漏、代码不一致 |
| ✅ 4 步法分轮提问 | 3,000 - 6,000 | 每个文件质量高、可控 |

**节省约 50-60% 的 token，且代码一致性更好。**

---

## 速查卡片（打印贴桌上）

```
┌──────────────────────────────────────────┐
│         阶段内 4 步操作法                  │
│                                          │
│  1️⃣  要清单  "列文件表格，不要写代码"       │
│  2️⃣  逐文件  "只输出这 1 个文件的完整代码"  │
│  3️⃣  组装    "生成 index.ts 和路由注册"    │
│  4️⃣  修复    "报错信息 + 相关代码片段"      │
│                                          │
│  省 token 三原则：                        │
│  ·  给摘要不给全文                         │
│  ·  要代码不要解释                         │
│  ·  报错给片段不给全量日志                  │
└──────────────────────────────────────────┘
```

---

## 跨阶段衔接提示词

当你完成一个阶段进入下一个阶段时，用这个模板开头：

```
我已完成以下阶段：
- 阶段 1：工程骨架（共享层：ApiResponse, AppError, errorHandler, authGuard, redis, env）
- 阶段 2：数据库（Drizzle schema 全表, BaseRepository, db 连接池）
- 阶段 3：商品域（ProductRepository, ProductService, ProductController, 缓存）

现在进入「阶段 4：用户与认证域」。

请列出需要创建的所有文件（表格格式），不要写代码。
```

这样 AI 知道你项目的全貌，又不需要你粘贴代码，token 消耗极低。
