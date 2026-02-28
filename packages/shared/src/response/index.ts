/**
 * 统一响应构建器
 * 严格遵循 CLAUDE.md 定义的响应格式：code + success + data + message + meta + traceId
 * traceId 由中间件注入，此处先占位空字符串
 */
import type { AppError } from '../errors/http-errors';

// ────────────────────────────── 类型定义 ──────────────────────────────

/** 分页元信息 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 分页数据包装 */
export interface PaginatedData<T> {
  items: T[];
  pagination: PaginationMeta;
}

/** 成功响应 */
export interface SuccessResponse<T> {
  code: 200;
  success: true;
  data: T;
  message: string;
  traceId: string;
}

/** 错误响应 */
export interface ErrorResponse {
  code: number;
  success: false;
  message: string;
  data: null;
  meta: {
    code: string;
    message: string;
    details?: unknown;
  };
  traceId: string;
}

/** 通用 API 响应类型 */
export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

// ────────────────────────────── 构建函数 ──────────────────────────────

/** 构建成功响应 */
export function success<T>(data: T, message = ''): SuccessResponse<T> {
  return {
    code: 200,
    success: true,
    data,
    message,
    traceId: '',
  };
}

/** 构建错误响应 */
export function error(err: AppError, traceId = ''): ErrorResponse {
  return {
    code: err.statusCode,
    success: false,
    message: err.message,
    data: null,
    meta: {
      code: err.errorCode || 'INTERNAL_ERROR',
      message: err.message,
      ...(err.details !== undefined && { details: err.details }),
    },
    traceId,
  };
}

/** 构建分页成功响应 */
export function paginated<T>(
  items: T[],
  pagination: PaginationMeta,
  message = ''
): SuccessResponse<PaginatedData<T>> {
  return {
    code: 200,
    success: true,
    data: {
      items,
      pagination,
    },
    message,
    traceId: '',
  };
}
