import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { redisIns } from '@/lib/redis.ts';
import { ApiResult } from '@/utils/response.ts';
import { logger } from '@/lib/logger.ts';
import { gatewayConfig } from './config.ts';

/**
 * 构建限流 key：IP + 可选的 userId
 *
 * 认证用户按 userId 限流，匿名用户按 IP 限流，
 * 可防止同一用户换 IP 绕过限制。
 */
export function resolveRateLimitKey(c: Context): string {
  const ip =
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    c.req.header('X-Real-IP') ??
    'unknown';

  const userId = c.get('gatewayUserId') as string | undefined;
  return userId ? `gw:rl:${userId}` : `gw:rl:${ip}`;
}

/**
 * 网关限流中间件（stub — 简单 INCR+EXPIRE 计数器）
 *
 * 当 gatewayConfig.rateLimit.enabled = false（默认），直接放行。
 * 启用后使用 Redis INCR + EXPIRE 做固定窗口计数。
 *
 * TODO: 生产升级 — 迁移到 src/middleware/rate-limit.ts 中的
 * Lua 滑动窗口脚本，获得更精确的限流效果。
 */
export const gatewayRateLimitMiddleware = createMiddleware(async (c, next) => {
  if (!gatewayConfig.rateLimit.enabled) {
    await next();
    return;
  }

  const { maxRequests, windowSeconds } = gatewayConfig.rateLimit;
  const key = resolveRateLimitKey(c);

  try {
    const count = await redisIns.incr(key);

    // 首次请求时设置过期时间
    if (count === 1) {
      await redisIns.expire(key, windowSeconds);
    }

    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - count)));

    if (count > maxRequests) {
      const ttl = await redisIns.ttl(key);
      c.header('Retry-After', String(Math.max(1, ttl)));
      logger.warn('Gateway rate limit exceeded', { key, count });
      return ApiResult.error(c, '请求过于频繁，请稍后再试', 429);
    }
  } catch (err) {
    // Redis 不可用时降级放行 (fail-open)
    logger.warn('Gateway rate limit check failed, bypassing', { error: String(err) });
  }

  await next();
});
