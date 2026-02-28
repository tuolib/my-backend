
ecommerce-platform/
├── package.json                  # Workspace 根配置
├── bunfig.toml                   # Bun 全局配置
├── turbo.json                    # Turborepo 构建编排
├── docker-compose.yml            # 本地开发环境 (PG + Redis + Caddy)
├── Caddyfile                     # 反向代理 / 网关层
├── .env.example
├── .gitignore
│
├── packages/                     # 共享库层
│   ├── shared/                   # 通用工具与核心抽象
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts                # 统一导出
│   │       ├── config/                 # 环境变量加载 & 校验 (env schema)
│   │       │   └── index.ts
│   │       ├── errors/                 # 统一错误类体系 (AppError, BizError…)
│   │       │   ├── index.ts
│   │       │   ├── http-errors.ts      # 400/401/403/404/409/422/500…
│   │       │   └── error-codes.ts      # 业务错误码枚举
│   │       ├── response/               # 统一响应格式 { code, data, message, traceId }
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
│   │
│   └── database/                 # 数据库层封装
│       ├── package.json
│       └── src/
│           ├── index.ts                # 统一导出
│           ├── client.ts               # PostgreSQL 连接池 (Drizzle / Kysely)
│           ├── redis.ts                # Redis 连接封装
│           ├── migrate.ts              # 迁移执行入口
│           └── migrations/             # SQL 迁移文件目录
│
├── apps/                         # 可部署进程
│   └── api-gateway/              # 阶段1：单体 API 入口
│       ├── package.json
│       └── src/
│           ├── index.ts                # Hono app 创建 & 启动
│           ├── app.ts                  # 中间件挂载、路由注册
│           └── routes/                 # 路由模块 (按业务域组织)
│               ├── health.ts           # 健康检查 /health
│               └── v1/                 # API 版本化
│                   └── index.ts
|── services/                           # 核心业务域服务（未来扩展）
│   ├── user-service/
│   ├── product-service/
│   ├── order-service/
│   ├── payment-service/
│   ├── inventory-service/
├── infra/                        # 纯基础设施，零业务代码
│   ├── docker/
│   │   ├── api-gateway/
│   │   └── base-images/
│   ├── caddy/
│   ├── postgres/                 # init.sql、pg_hba.conf 等
│   ├── redis/                    # redis.conf
│   └── docker-compose.yml        # 本地一键启动
├── scripts/                      # 运维 & 开发脚本
│   ├── setup.ts                  # 一键初始化 (建库、迁移、seed)
│   └── seed.ts                   # 测试数据填充
│
└── deploy/                       # 部署相关
├── Dockerfile                # 多阶段构建
└── docker-compose.prod.yml



