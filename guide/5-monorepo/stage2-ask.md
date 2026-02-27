




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


你是一位数据库架构师。请为高并发电商系统设计 PostgreSQL 数据模型。

技术栈：Bun + Drizzle ORM + PostgreSQL



项目介绍：企业级高并发电商架构
对标: Amazon / 阿里巴巴
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
工程结构：Monorepo

已完成：
- 阶段1 基础工程骨架
- 共享层：统一配置、统一响应格式、统一错误处理
- 基础设施：Dockerfile, docker-compose, Caddyfile

当前处于阶段：阶段2，数据库建模与分层

目标：
- 设计面向高并发电商的 PostgreSQL 数据模型，建立 Repository 模式，为读写分离预留接口。

### 操作清单
- [ ] 选择 ORM/Query Builder（Drizzle ORM 推荐）
- [ ] 设计核心表：users, products, skus, categories, orders, order_items, cart_items, payments, inventory
- [ ] 建立数据库迁移体系（drizzle-kit）
- [ ] 抽象 Repository 基类（CRUD 泛型）
- [ ] 数据库连接池配置（pg pool）
- [ ] 软删除、乐观锁（version 字段）、审计字段（created_at, updated_at, deleted_at）

你是一位数据库架构师。请为高并发电商系统设计 PostgreSQL 数据模型。

现在要做的是将这个模块分成多步骤实施，请告诉我第一步给Claude Code的提示词，不要超出500 token消耗







项目介绍：企业级高并发电商架构
对标: Amazon / 阿里巴巴
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
工程结构：Monorepo

已完成：
- 阶段1 基础工程骨架
- 共享层：统一配置、统一响应格式、统一错误处理
- 基础设施：Dockerfile, docker-compose, Caddyfile

当前处于阶段：阶段2，数据库建模与分层

目标：
- 设计面向高并发电商的 PostgreSQL 数据模型，建立 Repository 模式，为读写分离预留接口。

### 操作清单
- [ ] 选择 ORM/Query Builder（Drizzle ORM 推荐）
- [ ] 设计核心表：users, products, skus, categories, orders, order_items, cart_items, payments, inventory
- [ ] 建立数据库迁移体系（drizzle-kit）
- [ ] 抽象 Repository 基类（CRUD 泛型）
- [ ] 数据库连接池配置（pg pool）
- [ ] 软删除、乐观锁（version 字段）、审计字段（created_at, updated_at, deleted_at）

请完成阶段2第一步——数据库基础设施搭建：

1. 在 packages/database 下初始化包：
    - 安装 drizzle-orm, drizzle-kit, postgres（pg driver for drizzle）
    - package.json 配置 name: "@repo/database"

2. 数据库连接池配置：
    - src/client.ts：用 postgres 库创建连接池，从 @repo/shared 读取配置
    - 连接池参数：max: 20, idle_timeout: 30, connect_timeout: 10
    - 导出 db 实例（drizzle(client)）和关闭连接方法

3. 在 @repo/shared 的配置中补充数据库环境变量：
    - DATABASE_URL, DB_POOL_MAX, DB_POOL_IDLE_TIMEOUT

4. drizzle.config.ts 放在 packages/database 根目录

5. 在 docker-compose.yml 中确认 PostgreSQL 服务配置正确，添加 healthcheck

6. 建立目录结构：
   packages/database/
   ├── src/
   │   ├── client.ts        # 连接池
   │   ├── schema/           # 下一步放表定义
   │   └── index.ts          # 统一导出
   ├── drizzle.config.ts
   └── package.json

不要创建任何表结构，只搭建数据库连接基础设施。确保类型安全，代码简洁。