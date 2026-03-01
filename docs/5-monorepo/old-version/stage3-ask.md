

项目介绍：企业级高并发电商架构
对标: Amazon / 阿里巴巴
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
工程结构：Monorepo

已完成：
- 阶段1 基础工程骨架
- 阶段2：数据库建模与分层
- packages/shared：统一配置、响应格式、错误处理
- packages/database：Drizzle ORM 连接池、全部 schema（users, categories, products, skus, cart_items, orders, order_items, payments, inventory_logs）、Repository 基类（Base/SoftDelete/Versioned）及各实体 Repository

项目目录结构如下：

现在进入阶段3——核心商品域 API

你是一位电商后端开发专家，根据这个阶段3 核心商品域的情况，给出阶段3第一步给 claude code cli 的提示词，注意接口开发都用POST请求



## 阶段 3：核心商品域


项目介绍：企业级高并发电商架构
对标: Amazon / 阿里巴巴
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
工程结构：Monorepo

已完成：
- 阶段1 基础工程骨架
- 阶段2：数据库建模与分层
- packages/shared：统一配置、响应格式、错误处理
- packages/database：Drizzle ORM 连接池、全部 schema（users, categories, products, skus, cart_items, orders, order_items, payments, inventory_logs）、Repository 基类（Base/SoftDelete/Versioned）及各实体 Repository


你是一位电商后端开发专家。请先阅读项目结构再开始编码。

现在进入阶段3——核心商品域 API，第一步：商品分类 CRUD。

请先执行：
1. 阅读 packages/database/src/schema/categories.ts 了解表结构
2. 阅读 packages/database/src/repository/ 了解 Repository 模式
3. 阅读 packages/shared/src 了解响应格式和错误处理
4. 阅读现有 apps/ 目录了解 Hono 服务结构

然后实现商品分类模块：

一、Service 层 apps/api/src/modules/category/category.service.ts：
- getTree() — 返回完整分类树（利用 path/parent_id 构建嵌套结构）
- getById(id)
- create(data) — 自动生成 slug，设置 path
- update(id, data) — 如果 parent_id 变更需更新 path 及所有子分类 path
- delete(id) — 有子分类或关联商品时禁止删除

二、Controller 层 apps/api/src/modules/category/category.controller.ts：
- GET /api/v1/categories — 树形结构
- GET /api/v1/categories/:id
- POST /api/v1/categories（后续接入鉴权，当前先不加）
- PUT /api/v1/categories/:id
- DELETE /api/v1/categories/:id

三、Validation 用 Zod schema：
- category.validation.ts — createCategorySchema, updateCategorySchema

四、路由注册到 Hono app

用 @repo/shared 的统一响应格式包装所有返回，错误走统一错误处理。Service 注入 Repository 不直接操作 db。
