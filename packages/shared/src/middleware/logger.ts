/**
 * 请求日志中间件 — 记录请求/响应摘要
 * 生产环境输出结构化 JSON，开发环境输出彩色文本
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context';
import { createLogger } from '../utils/logger';

const log = createLogger('http');

export function logger(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const durationMs = Math.round(performance.now() - start);
    const status = c.res.status;

    log.info('request completed', { method, path, status, durationMs });
  };
}
