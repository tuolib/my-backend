/**
 * JWT 鉴权中间件 — 验证 Access Token + Redis 黑名单检查
 * 工厂函数模式：createAuthMiddleware(redis) 返回 MiddlewareHandler
 * Redis key: user:session:blacklist:{jti}
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context';
import type { Redis } from 'ioredis';
import { verifyAccessToken } from '../utils/jwt';
import { UnauthorizedError } from '../errors/http-errors';
import { ErrorCode } from '../errors/error-codes';

export function createAuthMiddleware(redis: Redis): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const authorization = c.req.header('Authorization');

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing authentication token');
    }

    const token = authorization.slice(7);
    const payload = await verifyAccessToken(token);

    // 检查 Redis 黑名单
    const blacklisted = await redis.get(
      `user:session:blacklist:${payload.jti}`
    );
    if (blacklisted !== null) {
      throw new UnauthorizedError(
        '登录凭证已被撤销',
        ErrorCode.TOKEN_REVOKED
      );
    }

    c.set('userId', payload.sub);
    c.set('userEmail', payload.email);
    c.set('tokenJti', payload.jti);

    await next();
  };
}
