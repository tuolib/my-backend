/**
 * HTTP 错误类体系
 * AppError 基类 + 按 HTTP 状态码分类的子类 + 通用业务错误 BizError
 * 参考 docs/architecture.md 6.1 节
 */
import type { ErrorCode } from './error-codes';

/** 应用错误基类 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    message: string,
    errorCode?: string,
    details?: unknown,
    isOperational = true
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = isOperational;
  }
}

/** 400 Bad Request — 参数格式错误 */
export class BadRequestError extends AppError {
  constructor(message = '请求参数错误', errorCode?: ErrorCode, details?: unknown) {
    super(400, message, errorCode, details);
    this.name = 'BadRequestError';
  }
}

/** 401 Unauthorized — 未登录 / Token 无效 */
export class UnauthorizedError extends AppError {
  constructor(message = '未授权，请先登录', errorCode?: ErrorCode, details?: unknown) {
    super(401, message, errorCode, details);
    this.name = 'UnauthorizedError';
  }
}

/** 403 Forbidden — 无权限访问 */
export class ForbiddenError extends AppError {
  constructor(message = '无权访问', errorCode?: ErrorCode, details?: unknown) {
    super(403, message, errorCode, details);
    this.name = 'ForbiddenError';
  }
}

/** 404 Not Found — 资源不存在 */
export class NotFoundError extends AppError {
  constructor(message = '资源不存在', errorCode?: ErrorCode, details?: unknown) {
    super(404, message, errorCode, details);
    this.name = 'NotFoundError';
  }
}

/** 409 Conflict — 资源冲突 */
export class ConflictError extends AppError {
  constructor(message = '资源冲突', errorCode?: ErrorCode, details?: unknown) {
    super(409, message, errorCode, details);
    this.name = 'ConflictError';
  }
}

/** 422 Validation Error — 业务校验失败 */
export class ValidationError extends AppError {
  constructor(message = '数据校验失败', errorCode?: ErrorCode, details?: unknown) {
    super(422, message, errorCode, details);
    this.name = 'ValidationError';
  }
}

/** 429 Rate Limit — 请求过于频繁 */
export class RateLimitError extends AppError {
  constructor(message = '请求过于频繁，请稍后再试', errorCode?: ErrorCode, details?: unknown) {
    super(429, message, errorCode, details);
    this.name = 'RateLimitError';
  }
}

/** 500 Internal Error — 系统内部错误 */
export class InternalError extends AppError {
  constructor(message = '系统内部错误', errorCode?: ErrorCode, details?: unknown) {
    super(500, message, errorCode, details, false);
    this.name = 'InternalError';
  }
}

/**
 * 通用业务错误
 * 当预定义的 HTTP 错误子类不满足需求时，使用 BizError 自定义 statusCode + errorCode
 */
export class BizError extends AppError {
  constructor(statusCode: number, errorCode: ErrorCode, message: string, details?: unknown) {
    super(statusCode, message, errorCode, details);
    this.name = 'BizError';
  }
}
