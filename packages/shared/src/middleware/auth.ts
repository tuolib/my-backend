import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context';

/** JWT / Session 鉴权中间件（预留） */
export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (_c, next) => {
    // TODO: 实现 JWT 验证逻辑
    await next();
  };
}
