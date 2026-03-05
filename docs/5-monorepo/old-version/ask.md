
核心原则： 分段设计、逐步交付、降低 token 消耗



项目介绍：企业级高并发电商架构
对标: Amazon
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
目标：搭建 Monorepo 工程结构、统一配置、统一响应格式、统一错误处理，为后续所有业务域提供基座

当前任务：我正在做 阶段1的基础工程骨架

当前已实现：
1. 目录结构采用 DDD 分层：src/{domain}/{controller,service,repository,schema,types}
2. 公共层 src/shared/{middleware,utils,config,types}
3. 统一响应格式 { success, data, error, meta }
4. 全局错误处理中间件，区分业务异常和系统异常
5. 请求日志中间件（method, path, status, duration）
6. 环境配置从 .env 加载，用 zod 做 schema 校验
7. /health 端点返回服务状态
8. 提供 Dockerfile（基于 oven/bun）和 docker-compose.yml（含 postgres、redis、caddy）
9. Caddy 做反向代理，自动 HTTPS

要求：
- 完善 src/domain 目录下接口都为post请求，不要其他请求方式
- 完善 Monorepo 工程结构



项目介绍：企业级高并发电商架构
对标: Amazon
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
目标：搭建 Monorepo 工程结构、统一配置、统一响应格式、统一错误处理，为后续所有业务域提供基座

当前任务：我正在做 阶段1的基础工程骨架

你的角色：你是一位资深后端架构师

我已经做了这些：
- Monorepo 工程结构的一级目录和各个文件夹分布
- 统一响应格式 在 src/shared/types/response.ts
- 统一错误处理 在 src/shared/types/errors.ts

要求：
- 如果有请求的地方，只要 post, 不要其他 get delete等等请求
- src 目录下的文件你不要扫描，除了上面的 统一响应格式 和 统一错误处理 你要用我的格式以外，其他的你不要用了
- 一级目录结构我只告诉你架构思维，不用实现代码
- 先实现 packages 目录下的功能代码：跨服务共享的基础能力, 目录结构和用途在如下介绍, 要实现的功能是：core，response， types，config



一级目录如下：
├─ apps/                    # 所有可独立部署的应用
├─ services/                # 核心业务域服务（未来扩展）
├─ packages/                # 跨服务共享的基础能力
├─ infra/                   # 基础设施与部署相关
├─ configs/                 # 全局统一配置

packages 基础功能目录结构：
packages/
├─ core/                    # 核心抽象（不依赖业务）
│  ├─ app-kernel/           # 应用生命周期 / 启动模型
│  ├─ http/                 # Request / Response 抽象
│  ├─ error/                # 错误体系定义
│  └─ context/              # 请求上下文（trace / auth）
├─ response/                # 统一响应格式标准
└─ types/                   # 全局 TypeScript 类型
├─ config/                  # 统一配置加载规范
│  ├─ env/                  # 环境变量 schema
│  └─ runtime/              # 多环境配置解析






项目介绍：企业级高并发电商架构
对标: Amazon
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
目标：搭建 Monorepo 工程结构、统一配置、统一响应格式、统一错误处理，为后续所有业务域提供基座

当前任务：我正在做 阶段1的基础工程骨架

你的角色：你是一位资深后端架构师

我已经做了这些：
- Monorepo 工程结构的一级目录和各个文件夹分布
- 已实现 packages 目录下的功能代码：core，response， types，config, cache, database, middleware, validation

要求：
- 如果有请求的地方，只要 post, 不要其他 get delete等等请求
- 目前你要结合 docker 和 bun 开始启动本地开发环境，启动入口文件 在 apps/api-gateway/src/main.ts



1 你觉得需要单独加一个 apps 目录吗？
apps/
├─ api-gateway/             # API 网关（唯一外部入口）


2 你觉得需要加一个 infra 目录替换掉你的 packages/database 吗？
infra/
├─ docker/
│  ├─ api-gateway/
│  └─ base-images/
│
├─ caddy/                   # 网关 / TLS / 反向代理（:contentReference[oaicite:4]{index=4}）
│
├─ postgres/
├─ redis/
└─ local-dev/               # 本地一键启动方案

infra/postgres/pg-client.ts 的代码：
import { Pool } from 'pg';

export const pgPool = new Pool({
connectionString: process.env.DATABASE_URL,
});

export async function query(sql: string, params?: any[]) {
return pgPool.query(sql, params);
}

export interface Database {
query(sql: string, params?: any[]): Promise<any>
}

接着专门有一个 packages/database/index.ts 的实例
let dbInstance: Database

export function setDatabase(db: Database) {
dbInstance = db
}

export function getDb(): Database {
if (!dbInstance) throw new Error("Database not initialized")
return dbInstance
}


然后在用到的services里进行初始化, 然后这个服务就可以自己调用了 getDb：
import { setDatabase } from "@database";
setDatabase({ query });



shared/                   # 通用工具与核心抽象
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts                # 统一导出
│   │       ├── config/                 # 环境变量加载 & 校验 (env schema)
│   │       │   └── index.ts
│   │       ├── errors/                 # 统一错误类体系 (AppError, BizError…)
│   │       │   ├── index.ts
│   │       │   ├── http-errors.ts      # 400/401/403/404/409/422/500…
│   │       │   └── error-codes.ts      # 业务错误码枚举
│   │       ├── response/               # 统一响应格式
│   │       │   └── index.ts
│   │       ├── middleware/             # 可复用 Hono 中间件
│   │       │   ├── error-handler.ts    # 全局异常捕获 → 统一响应
│   │       │   ├── request-id.ts       # traceId 注入
│   │       │   ├── logger.ts           # 请求日志
│   │       │   ├── validate.ts         # Zod 参数校验中间件
│   │       │   └── auth.ts             # JWT / Session 鉴权 (预留)
│   │       ├── types/                  # 全局 TS 类型
│   │       │   └── index.ts
│   │       └── utils/                  # 通用工具函数
│   │           ├── id.ts               # 分布式 ID 生成 (snowflake / nanoid)
│   │           └── time.ts





项目介绍：企业级高并发电商架构
对标: Amazon
技术栈: Bun | Hono | PostgreSQL | Redis | Docker | Caddy
工程结构：Monorepo

已完成：
- 阶段1 基础工程骨架
- 共享层：统一配置、统一响应格式、统一错误处理

你是一位资深后端架构师， 当前任务：
- 提供 Dockerfile（基于 oven/bun）和 docker-compose.yml（含 postgres、redis、caddy） 精简的本地开发和部署脚本
- Caddy 做反向代理，自动 HTTPS

