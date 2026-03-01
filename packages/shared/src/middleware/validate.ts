/**
 * Zod 参数校验中间件 — 校验 JSON body
 * 工厂函数模式：validate(schema) 返回 MiddlewareHandler
 * 校验失败抛出 ValidationError(422)，details 包含 zod flatten errors
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context';
import { ValidationError } from '../errors/http-errors';

/** Structural type compatible with both Zod v3 and v4 */
interface ParseableSchema {
  safeParse(data: unknown):
    | { success: true; data: unknown; error?: undefined }
    | { success: false; error: { flatten(): unknown }; data?: undefined };
}

export function validate(schema: ParseableSchema): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const body = await c.req.json();
    const result = schema.safeParse(body);

    if (!result.success) {
      const flattened = result.error.flatten();
      throw new ValidationError('数据校验失败', undefined, flattened);
    }

    c.set('validated', result.data);
    await next();
  };
}
