你现在在仓库根目录执行开发任务，请严格按“第一步”实现，不要提前做后续步骤。

【参考文档】
- ./claude/architecture/stage2_apigateway.md

【任务阶段】
- 阶段二：核心服务设计 - API 网关
- 第一步：先搭建“可运行的网关骨架 + 统一配置契约”

【第一步目标】
1) 建立 API Gateway 的基础目录与类型定义（为后续认证、限流、代理、熔断预留扩展点）。
2) 抽离网关配置（路由映射、下游超时、重试策略开关、健康检查配置），使用集中配置文件管理。
3) 暴露基础系统端点：`/health`（存活）和 `/ready`（Redis 连通性检查，失败返回 503）。
4) 保持统一响应结构：`{ code, data, message, success }`（若项目已有实现则复用并补齐）。
- 必要时最小改动 `src/router.ts` / `src/utils/response.ts`（仅为契约统一）

【本步明确不做】
- 不实现 JWT 认证逻辑
- 不实现熔断器逻辑
- 不实现复杂重试策略
  （这些只留接口/占位和 TODO 注释）

【代码要求】
- TypeScript + Bun + Hono 风格，遵循现有项目结构
- 优先复用已有工具函数（如 Redis 检查、统一响应工具）
- 注释简洁，只写关键设计点
- 不新增无关依赖

【验收标准】
- 能启动服务
- `GET /health` 返回 200
- `GET /ready`：Redis 正常返回 200，异常返回 503
- 返回体符合统一结构
- 网关配置集中且可读，后续可直接扩展到“认证/限流/代理/熔断”

2) 每个文件改动目的（1-2 句）
3) 如何本地验证（命令 + 预期结果）
4) 当前遗留的 TODO（供下一步继续）







请以高质量工程师身份协助下一步实现「阶段二：核心服务设计 - API 网关」中的第二步内容，基于 claude/architecture/
stage2_apigateway.md 的要求。按以下模板填写或直接使用，确保结果可直接接入现有项目（Bun + Hono + TypeScript）：

你是高并发电商网关的核心实现专家，当前任务在 `claude/architecture/stage2_apigateway.md` 的阶段二：“API 网关”里，已经完
成骨架与统一响应的第一步，现在要做第二步。

1. 目标：在现有 API Gateway 骨架上加入具体“认证/限流/路由/容错”占位模块（不需要完成全部逻辑），确保架构可演进到完整网
   关。
2. 具体需求：
    - 创建或扩展 `src/gateway` 下的模块：
        * `auth.ts`：定义 `authenticateRequest(c)` 構造、JWT 黑名单校验接口、依赖 Redis 函数，当前仅返回 `null`/`true`，
        * `proxy/router.ts`：设计内部路由表结构（静态 map + downsteam metadata），包括超时、熔断/重试 config，接口返回
          placeholder route info。
    - 将这些模块在 `src/index.ts` 或路由中以中间件形式挂载，并与现有统一响应、Redis 检测配合，确保 request lifecycle 顺
      畅（即使功能是 stub）。
    - 提供健康 / readiness 端点：`/health` 继续无状态响应；`/ready` 增加 Redis 连接 &黑名单 check（reuse `src/lib/
  redis.ts` 的 readiness API）。
    - 所有响应必须遵循 `{ code, success, message, data }`，包括中间件阻断（429/401/403/502/504 等）。
    - 留出扩展点（配置、依赖注入、 tracers），并用 TODO 短注解释后续实现方向。

3. 限制：
    - 不能引入新依赖；
    - 不能触及业务路由（`/api/v1/...`）的具体实现；
    - TODO 标签必须指出未来更详细实现。

4. 输出：
    - 生成或更新模块，确保它们 export 可测试的 helper；
    - 提供手动测试（`bun run dev` + `curl /health /ready`）的预期行为；
    - 如果需要，给出 README 片段或注释说明如何接着接入真正限流/认证/代理逻辑。

5. 检查点：
    - `GET /ready` 在 Redis 不通时返回 503，并附带统一响应格式；
    - 中间件在限流/认证失败时返回 429/401；
    - 网关配置可用 JSON/YAML/TS 注入。

请按照上述框架编写代码结构、接口和 TODO，精炼描述每个步骤要点，输出可直接交付的代码与说明。





你正接手“阶段二：核心服务设计 - API 网关”中第三步的实现，请按下列模板写出高质量工程师版的指导（Bun + Hono +
TypeScript），确保 Claude 生成的代码能紧密接续第二步的骨架和占位逻辑：

你是高并发电商 API 网关专家，目前在 `claude/architecture/stage2_apigateway.md` 的阶段二：“API 网关”任务里，第一步搭建
骨架，第二步加入认证/限流/路由/容错占位，现在要落实第三步。

1. 目标：构建核心网关执行流，使请求能经过认证/限流判断，选择下游目标并返回统一响应，同时可以对失败请求快速降级（熔断/
   超时/降级流程占位）。
    - 在 `src/gateway` 下新增或完善：
        * `executor.ts`：实现 `handleRequest(c)`，顺序执行认证、限流、路由查找、下游调用决策（调用占位函数
          `dispatchToService`），封装调用超时与熔断判断（可用配置 flag + TODO）。
        * `proxy/dispatch.ts`：定义 `dispatchToService(route, c)` 接口，返回模拟响应，包含超时重试钩子、错误映射
          （429/502/504），并暴露未来可替换的 HTTP 客户端注入点。
        * `config.ts`：确保路由表（服务名、url、timeout、retryPolicy、circuitBreakerThreshold）可从 JSON/TS 导入，并且可
          以在 `startServer` 时注入。
    - 在主入口或路由中创建 `gatewayMiddleware`，把 `executor.handleRequest` 作为 `router.all('*', gatewayMiddleware)`
      之前的 hook，确保 `/health`/`/ready` 保持独立。
    - 统一错误处理：任何网关层中断（未认证/限流/路由未识别/下游失败）都返回 `{ code, success, message, data }`，并附带
      `X-Request-ID`（如果存在）。
    - 报错响应需区分：401（未授权）、429（限流）、502/504（下游问题）、500（网关内部）。所有 stub 都需标明 TODO 实现细
      节。
    - 记录简单日志（可用现有 `logger`）以便后续调试。

3. 限制：不要调用真实下游服务；不要引入新库；不要修改业务路由逻辑；尽量 reuse `src/utils/response.ts` 和 `src/lib/
  logger.ts`。

4. 输出：描述施工步骤、重要类型定义、可调用接口；在模板中直接给出示例代码块（Bun + Hono 格式）和 expected curl/npx 测
   试说明；标明 TODO 需要扩展的部分（实际 HTTP client、熔断状态、重试状态）。

5. 检查点：
    - 认证或限流失败直接返回对应 `code/success=false`；
    - Route lookup 未找到时返回 404 同时依旧统一结构；
    - 下游“超时”或“被标记为熔断”时返回 504/502；
    - 成功转发时返回 data 包含 `service` 字段和 placeholder payload。

请按照上述描述，生成 third-step Claude Prompt，使 Claude 能输出具体模块实现与说明。```









