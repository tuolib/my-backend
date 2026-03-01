/**
 * 请求日志中间件 — 记录请求/响应摘要
 * 格式：[traceId] POST /api/v1/product/list → 200 (12ms)
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context';

export function logger(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const duration = Math.round(performance.now() - start);
    const traceId = c.get('traceId') ?? '-';
    const status = c.res.status;

    console.log(`[${traceId}] ${method} ${path} → ${status} (${duration}ms)`);
  };
}
