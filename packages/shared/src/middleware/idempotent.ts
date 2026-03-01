/**
 * 幂等中间件 — 防止重复提交
 * 工厂函数模式：createIdempotentMiddleware(redis) 返回 MiddlewareHandler
 * Redis key: order:idempotent:{key}，TTL 24h
 * 有 X-Idempotency-Key 时检查 Redis，命中则返回 409
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context';
import type { Redis } from 'ioredis';
import { ConflictError } from '../errors/http-errors';
import { ErrorCode } from '../errors/error-codes';

const IDEMPOTENT_TTL = 86400; // 24h

export function createIdempotentMiddleware(
  redis: Redis
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const idempotencyKey = c.req.header('X-Idempotency-Key');

    if (!idempotencyKey) {
      await next();
      return;
    }

    const redisKey = `order:idempotent:${idempotencyKey}`;
    const existing = await redis.get(redisKey);

    if (existing !== null) {
      const traceId = c.get('traceId') ?? '';
      return c.json(
        {
          code: 409,
          success: false,
          message: '请勿重复提交',
          data: null,
          meta: {
            code: ErrorCode.IDEMPOTENT_CONFLICT,
            message: '请勿重复提交',
            details: { originalResponse: JSON.parse(existing) },
          },
          traceId,
        },
        409
      );
    }

    await next();

    // 请求完成后，缓存响应体
    const responseBody = await c.res.clone().text();
    await redis.set(redisKey, responseBody, 'EX', IDEMPOTENT_TTL);
  };
}
