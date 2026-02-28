/**
 * 请求 ID 中间件 — 为每个请求注入 traceId
 * 优先使用请求 header X-Request-Id，没有则用 generateId() 生成
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context';
import { generateId } from '../utils/id';

export function requestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const traceId = c.req.header('X-Request-Id') ?? generateId();
    c.set('traceId', traceId);
    c.header('X-Request-Id', traceId);
    await next();
  };
}
