

项目介绍：企业级高并发电商架构
对标: Amazon / 阿里巴巴
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







核心原则： 分段设计、逐步交付、降低 token 消耗