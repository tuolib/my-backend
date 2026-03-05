/**
 * 全局异常捕获 — Hono app.onError 处理函数
 * 将 AppError 转为标准错误响应，未知错误包装为 500
 * 响应格式严格遵循 CLAUDE.md：{ code, success, message, data, meta, traceId }
 */
import type { ErrorHandler } from 'hono';
import type { AppEnv } from '../types/context';
import { AppError } from '../errors/http-errors';
import { createLogger } from '../utils/logger';

const log = createLogger('error-handler');

export const errorHandler: ErrorHandler<AppEnv> = async (err, c) => {
  const traceId = c.get('traceId') ?? '';

  // 提取请求上下文，便于定位问题
  const requestContext: Record<string, unknown> = {
    method: c.req.method,
    path: c.req.path,
    userId: c.get('userId') ?? undefined,
  };
  // 安全读取 body（仅 POST/PUT/PATCH）
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    try {
      requestContext.body = await c.req.json();
    } catch {
      // body 已被消费或非 JSON，忽略
    }
  }

  if (err instanceof AppError) {
    const errorFields = {
      errorCode: err.errorCode || 'INTERNAL_ERROR',
      statusCode: err.statusCode,
      ...requestContext,
      stack: err.stack,
    };

    if (err.statusCode >= 500) {
      log.error(err.message, errorFields);
    } else if (err.statusCode >= 400) {
      log.warn(err.message, errorFields);
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
  log.error('unhandled error', {
    error: err instanceof Error ? err.message : String(err),
    ...requestContext,
    stack: err instanceof Error ? err.stack : undefined,
  });

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
