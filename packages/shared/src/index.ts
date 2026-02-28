/**
 * @repo/shared 统一导出
 * 所有子模块的公开 API 从此处导出，禁止深层路径导入
 */

// ── config ──
export { getConfig, envSchema } from './config';
export type { AppConfig, Env } from './config';

// ── errors ──
export {
  ErrorCode,
  errorMessages,
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  InternalError,
  BizError,
} from './errors';

// ── response ──
export { success, error, paginated } from './response';
export type {
  SuccessResponse,
  ErrorResponse,
  ApiResponse,
  PaginatedData as ResponsePaginatedData,
  PaginationMeta as ResponsePaginationMeta,
} from './response';

// ── types ──
export type {
  PaginationInput,
  PaginationMeta,
  PaginatedData,
  SortOrder,
  ServiceContext,
  IdempotencyResult,
  Nullable,
  ID,
} from './types';

export type {
  AuthUser,
  JwtPayload,
  RequestContext,
  AppEnv,
} from './types/context';

// ── utils ──
export { generateId, generateOrderNo } from './utils/id';
export { now, addMinutes, addDays, isExpired, formatISO } from './utils/time';

// ── middleware ──
// 中间件模块将在 Phase 2 Step 2 中完善并导出
// 当前骨架文件存在于 src/middleware/ 但依赖尚未安装（@hono/zod-validator 等）
