import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context';

/** 请求 ID 中间件 — 为每个请求生成唯一标识 */
export function requestIdMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId = c.req.header('X-Request-ID') ?? crypto.randomUUID();
    const traceId = c.req.header('X-Trace-Id') ?? requestId;

    c.set('requestId', requestId);
    c.set('traceId', traceId);

    c.header('X-Request-ID', requestId);
    c.header('X-Trace-Id', traceId);

    await next();
  };
}
