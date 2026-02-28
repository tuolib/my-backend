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
  AccessTokenPayload,
  RefreshTokenPayload,
  AppEnv,
} from './types/context';

// ── utils ──
export { generateId, generateOrderNo } from './utils/id';
export { now, addMinutes, addDays, isExpired, formatISO } from './utils/time';
export { hashPassword, verifyPassword, sha256 } from './utils/hash';
export {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './utils/jwt';

// ── middleware ──
export { requestId } from './middleware/request-id';
export { logger } from './middleware/logger';
export { errorHandler } from './middleware/error-handler';
export { validate } from './middleware/validate';
export { createAuthMiddleware } from './middleware/auth';
export { createIdempotentMiddleware } from './middleware/idempotent';
