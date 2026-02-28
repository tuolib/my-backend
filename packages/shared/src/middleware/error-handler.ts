/**
 * 全局异常捕获 — Hono app.onError 处理函数
 * 将 AppError 转为标准错误响应，未知错误包装为 500
 * 响应格式严格遵循 CLAUDE.md：{ code, success, message, data, meta, traceId }
 */
import type { ErrorHandler } from 'hono';
import type { AppEnv } from '../types/context';
import { AppError } from '../errors/http-errors';

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const traceId = c.get('traceId') ?? '';

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      console.error(`[${traceId}] ${err.name}: ${err.message}`, err.stack);
    }

    return c.json(
      {
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
      },
      err.statusCode as 400
    );
  }

  // 未知错误
  console.error(`[${traceId}] Unhandled error:`, err);

  const message =
    process.env.NODE_ENV === 'production'
      ? '系统内部错误'
      : err instanceof Error
        ? err.message
        : String(err);

  return c.json(
    {
      code: 500,
      success: false,
      message,
      data: null,
      meta: {
        code: 'INTERNAL_ERROR',
        message,
      },
      traceId,
    },
    500
  );
};
