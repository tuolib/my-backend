import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
// import { logger } from '@/lib/logger.ts';

export type ApiResponse<T = any> = {
  code: number;
  success: boolean;
  message: string | null;
  data: T;
  meta?: Record<string, unknown>;
};

const appendRequestIdFor5xx = (c: Context, message: string, code: number) => {
  if (code < 500 || code >= 600) return message;
  if (message.includes('requestId')) return message;
  const requestId = c.res.headers.get('X-Request-ID') ?? c.req.header('X-Request-ID');
  if (!requestId) return message;
  return `${message} (requestId: ${requestId})`;
};

export const ApiResult = {
  success: <T>(
    c: Context,
    data: T = null as any,
    message = '操作成功',
    meta?: Record<string, unknown>
  ) => {
    const response: ApiResponse<T> = { code: 200, success: true, message, data, meta };
    return c.json(response, 200);
  },

  error: (
    c: Context,
    message = '操作失败',
    code: ContentfulStatusCode = 400,
    data: any = null,
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
};

export const onZodError = (result: any, c: Context) => {
  if (!result.success) {
    const error = result.error as z.ZodError;
    const message = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return c.json({ code: 400, success: false, message, data: null }, 400);
  }
};
