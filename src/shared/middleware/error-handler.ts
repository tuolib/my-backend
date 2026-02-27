import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { AppError } from '@/shared/types/errors';
import { ApiResult } from '@/shared/types/response';
import { logger } from '@/shared/utils/logger';

export function errorHandler(err: Error, c: Context) {
  // Zod validation error
  if (err instanceof ZodError) {
    const messages = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    // return c.json(fail("Validation failed", { details: messages }), 400);
    return ApiResult.error(c, 'Validation failed', 400, { details: messages });
  }

  // Business error
  if (err instanceof AppError) {
    // return c.json(fail(err.message, { code: err.code }), err.statusCode as any);
    return ApiResult.error(c, err.message, err.statusCode as any, { code: err.code });
  }

  // Hono HTTP exception
  if (err instanceof HTTPException) {
    // return c.json(fail(err.message), err.status);
    return ApiResult.error(c, err.message, 400, err.status);
  }

  // System error — hide details in production
  logger.error({ err, path: c.req.path, method: c.req.method }, 'Unhandled error');
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  // return c.json(fail(message, { code: "INTERNAL_ERROR" }), 500);
  return ApiResult.error(c, message, 500, { code: 'INTERNAL_ERROR' });
}
