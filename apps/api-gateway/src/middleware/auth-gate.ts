/**
 * 鉴权网关中间件 — 区分公开/认证路由
 * 公开路由跳过 JWT 验证，其余路由必须携带有效 token
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '@repo/shared';
import { createAuthMiddleware } from '@repo/shared';
import { redis } from '@repo/database';
import { isPublicRoute } from '../config/public-routes';

const authMiddleware = createAuthMiddleware(redis);

export function authGate(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (isPublicRoute(c.req.path)) {
      return next();
    }
    return authMiddleware(c, next);
  };
}
