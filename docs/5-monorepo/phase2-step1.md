# Phase 2 — Step 1: packages/shared 基础层（config + errors + response + types + utils）

## 前置条件
Phase 1 已完成。请先确认 `bun install` 正常、`packages/shared/package.json` 存在且 name 为 `@repo/shared`。

## 本次任务
实现 packages/shared 的基础层（不含中间件）。中间件依赖这些基础模块，将在下一步实现。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `CLAUDE.md`（编码规范 + 响应格式）
- `docs/architecture.md` 第 6 章（错误码体系）+ Phase 2 章节

### 第二步：审计现有 packages/shared
扫描 `packages/shared/src/` 下已有的文件，列出哪些模块已存在、哪些缺失。
已存在的模块：对照架构规范检查实现是否一致，不一致的需要修正。

### 第三步：安装依赖
```bash
cd packages/shared
bun add zod hono nanoid@3
bun add -d typescript @types/bun
```
注意：nanoid 使用 v3（v4 是 ESM-only，与当前配置兼容性更好）。
不要安装 argon2、jose/jsonwebtoken 等——JWT 和密码哈希依赖较重，留到 Phase 2 Step 2。

### 第四步：实现基础模块

按以下顺序实现（每个文件头部加注释说明用途）：

**4a. `src/config/index.ts` — 环境变量加载 & Zod 校验**
```
- 定义 envSchema（Zod object），涵盖 .env.example 中所有变量
- 分组：server / database / redis / jwt / internal
- 每个变量都有默认值或标记 optional，但关键变量（DATABASE_URL, REDIS_URL, JWT secrets）在 production 时必填
- 导出 getConfig() 函数：解析 process.env → 返回类型安全的配置对象
- 导出 config 类型（z.infer<typeof envSchema>）
- 启动时调用如果校验失败，打印清晰的错误信息并 process.exit(1)
```

**4b. `src/errors/error-codes.ts` — 业务错误码枚举**
```
- 完整实现 docs/architecture.md 6.2 节的 ErrorCode 枚举
- 包含全部 5 个域：User(1xxx), Product(2xxx), Cart(3xxx), Order(4xxx), Gateway(9xxx)
- 导出 ErrorCode 枚举 + errorMessages Record（每个错误码对应默认中文提示语）
```

**4c. `src/errors/http-errors.ts` — HTTP 错误类体系**
```
- AppError 基类（继承 Error）：
  属性：statusCode, errorCode?, message, details?, isOperational(默认true)
  
- 子类（每个对应一个 HTTP 状态码，参考 architecture.md 6.1）：
  BadRequestError (400)
  UnauthorizedError (401)
  ForbiddenError (403)
  NotFoundError (404)
  ConflictError (409)
  ValidationError (422)
  RateLimitError (429)
  InternalError (500)
  
- 每个子类构造函数接受：message?, errorCode?, details?
- BizError 类：通用业务错误，接受 statusCode + errorCode + message
```

**4d. `src/errors/index.ts` — 错误模块统一导出**

**4e. `src/response/index.ts` — 统一响应构建器**
```
严格遵循以下格式：

// 成功响应
function success<T>(data: T, message?: string): SuccessResponse<T>
返回：
{
  code: 200,
  success: true,
  data: data,
  message: message || "",
  traceId: ""    // traceId 由中间件注入，这里先占位空字符串
}

// 错误响应
function error(err: AppError, traceId?: string): ErrorResponse
返回：
{
  code: err.statusCode,    // 如 400, 401, 404, 422, 500
  success: false,
  message: err.message,    // 用户可见提示语
  data: null,
  meta: {
    code: err.errorCode || "INTERNAL_ERROR",   // 业务错误码
    message: err.message,                       // 开发者描述
    details: err.details || undefined           // 校验错误详情
  },
  traceId: traceId || ""
}

// 分页成功响应（便捷方法）
function paginated<T>(items: T[], pagination: PaginationMeta, message?: string): SuccessResponse<PaginatedData<T>>

// 导出 TS 类型：SuccessResponse<T>, ErrorResponse, PaginatedData<T>, PaginationMeta, ApiResponse<T>
```

**4f. `src/types/index.ts` — 全局 TS 类型**
```
- PaginationInput: { page: number; pageSize: number; sort?: string; order?: "asc" | "desc" }
- PaginationMeta: { page: number; pageSize: number; total: number; totalPages: number }
- PaginatedData<T>: { items: T[]; pagination: PaginationMeta }
- SortOrder: "asc" | "desc"
- ServiceContext: { userId?: string; traceId: string; }  // 会挂到 Hono context 上
- IdempotencyResult: { exists: boolean; originalResponse?: unknown }
```

**4g. `src/utils/id.ts` — ID 生成器**
```
- generateId(): string — nanoid(21)，通用主键
- generateOrderNo(): string — 订单号：日期前缀 + 随机串，如 "20250228A7xK9mP3"
  格式：YYYYMMDD + nanoid(8)，保证可读性 + 唯一性
```

**4h. `src/utils/time.ts` — 时间工具**
```
- now(): Date
- addMinutes(date: Date, minutes: number): Date
- addDays(date: Date, days: number): Date
- isExpired(date: Date): boolean
- formatISO(date: Date): string
```

**4i. `src/index.ts` — 统一导出**
```
导出所有子模块的公开 API。
用户应该能这样导入：
import { 
  getConfig, AppError, NotFoundError, ValidationError, ErrorCode,
  success, error, paginated,
  generateId, generateOrderNo, now, addMinutes, isExpired,
  type ServiceContext, type PaginationInput, type PaginationMeta
} from "@repo/shared";
```

### 第五步：编写单元测试

为以下模块编写 `*.test.ts`（与源文件同目录）：

- `src/errors/http-errors.test.ts`：测试每个错误类的 statusCode、message、errorCode 是否正确
- `src/response/index.test.ts`：测试 success()、error()、paginated() 的返回结构是否严格匹配格式
- `src/utils/id.test.ts`：测试 generateId 长度为 21、generateOrderNo 格式正确
- `src/utils/time.test.ts`：测试 addMinutes、isExpired 逻辑正确
- `src/config/index.test.ts`：测试缺少必要变量时抛出错误

### 第六步：验证
```bash
cd packages/shared
bun test                    # 所有测试通过
bun run build               # 编译无错误（如果有 build script）
cd ../..
bun install                 # workspace 依赖正常
```

### 第七步：输出报告
- 新增/修改的文件清单
- 测试结果
- 下一步（Phase 2 Step 2）需要实现的模块预告：hash.ts, jwt.ts, 全部中间件

## 重要约束
- 本步不实现中间件（error-handler, auth, validate 等）—— 留给下一步
- 本步不实现 hash.ts 和 jwt.ts —— 需要额外依赖，留给下一步
- 响应格式必须严格匹配 CLAUDE.md 中定义的结构（code + success + data + message + meta + traceId）
- 所有导出通过 src/index.ts 统一出口，禁止深层路径导入
