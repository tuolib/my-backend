/**
 * 请求 ID 中间件 — 为每个请求注入 traceId
 * 优先使用请求 header X-Request-Id，没有则用 generateId() 生成
 */
import type { MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from '../types/context';
import { generateId } from '../utils/id';
import { requestContext } from '../utils/request-context';

export function requestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const traceId = c.req.header('X-Request-Id') ?? generateId();
    c.set('traceId', traceId);
    c.header('X-Request-Id', traceId);
    await requestContext.run({ traceId }, next);

    // 为 JSON 响应注入 traceId（成功响应构建器仅占位空字符串）
    const contentType = c.res.headers.get('Content-Type');
    if (contentType?.includes('application/json')) {
      const body = await c.res.json();
      body.traceId = traceId;
      c.res = c.json(body, c.res.status as ContentfulStatusCode);
    }
  };
}
