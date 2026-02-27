import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import type { PaginatedResult, PaginationParams } from '../types';

/** 统一接口响应类型 */
export type ApiResponse<T = unknown> = {
  code: number;
  success: boolean;
  message: string | null;
  data: T;
  meta?: Record<string, unknown>;
};

/** 5xx 错误追加 requestId 辅助 */
const appendRequestIdFor5xx = (c: Context, message: string, code: number): string => {
  if (code < 500 || code >= 600) return message;
  if (message.includes('requestId')) return message;
  const requestId = c.res.headers.get('X-Request-ID') ?? c.req.header('X-Request-ID');
  if (!requestId) return message;
  return `${message} (requestId: ${requestId})`;
};

/** 统一响应工具 */
export const ApiResult = {
  /** 成功响应 */
  success: <T>(
    c: Context,
    data: T = null as T,
    message = '操作成功',
    meta?: Record<string, unknown>
  ) => {
    const response: ApiResponse<T> = { code: 200, success: true, message, data, meta };
    return c.json(response, 200);
  },

  /** 错误响应 */
  error: (
    c: Context,
    message = '操作失败',
    code: ContentfulStatusCode = 400,
    data: unknown = null,
    meta?: Record<string, unknown>
  ) => {
    const response: ApiResponse = {
      code,
      success: false,
      message: appendRequestIdFor5xx(c, message, code),
      data,
      meta,
    };
    return c.json(response, code);
  },

  /** 分页响应 */
  paginated: <T>(
    c: Context,
    data: T[],
    pagination: PaginationParams & { total: number },
    message = '操作成功'
  ) => {
    const result: PaginatedResult<T> = {
      items: data,
      total: pagination.total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
    const response: ApiResponse<PaginatedResult<T>> = {
      code: 200,
      success: true,
      message,
      data: result,
      meta: {
        totalPages: Math.ceil(pagination.total / pagination.pageSize),
      },
    };
    return c.json(response, 200);
  },
};

/** Zod validator hook — 用于 @hono/zod-validator 的 hook 参数 */
export const onZodError = (result: { success: boolean; error?: z.ZodError }, c: Context) => {
  if (!result.success) {
    const error = result.error!;
    const message = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return c.json({ code: 400, success: false, message, data: null } satisfies ApiResponse, 400);
  }
};
