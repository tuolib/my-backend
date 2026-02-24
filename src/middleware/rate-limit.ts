import { createMiddleware } from 'hono/factory';
import { redisIns } from '@/lib/redis.ts';
import { ApiResult } from '@/utils/response.ts';
import { logger } from '@/lib/logger.ts';

interface RateLimitOptions {
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大请求数 */
  max: number;
  /** Redis key 前缀，用于区分不同端点的限流桶 */
  keyPrefix?: string;
}

const isRateLimitEnabled = (): boolean => {
  const raw = false;
  if (raw == null) return true;
  return !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase());
};

/**
 * Redis 滑动窗口限流（Sliding Window Log via Sorted Set + Lua）。
 *
 * 选型依据：
 * - 使用 Sorted Set：score = 时间戳，member = 唯一请求 ID
 * - ZREMRANGEBYSCORE 删除窗口外的旧记录，实现真正的滑动窗口
 * - Lua 脚本保证 "判断 + 写入" 的原子性，防止并发竞态
 * - 多 Pod 场景下，所有实例共享同一 Redis，限流精确
 *
 * 降级策略：Redis 不可用时放行请求，保证服务可用性优先于限流精确性。
 */
const SLIDING_WINDOW_SCRIPT = `
  local key    = KEYS[1]
  local now    = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit  = tonumber(ARGV[3])
  local member = ARGV[4]
  local ttl    = tonumber(ARGV[5])

  redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
  local count = tonumber(redis.call('ZCARD', key))

  if count >= limit then
    return -1
  end

  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, ttl)
  return limit - count - 1
`;

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyPrefix = 'rl:' } = options;
  const windowSec = Math.ceil(windowMs / 1000) + 1;

  return createMiddleware(async (c, next) => {
    if (!isRateLimitEnabled()) {
      await next();
      return;
    }

    const ip =
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
      c.req.header('X-Real-IP') ??
      'unknown';

    const key = `${keyPrefix}${ip}`;
    const now = Date.now();
    // 唯一 member 防止相同时间戳的请求互相覆盖
    const member = `${now}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      const remaining = (await redisIns.eval(SLIDING_WINDOW_SCRIPT, {
        keys: [key],
        arguments: [String(now), String(windowMs), String(max), member, String(windowSec)],
      })) as number;

      c.header('X-RateLimit-Limit', String(max));
      c.header('X-RateLimit-Remaining', String(Math.max(0, remaining)));
      c.header('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));

      if (remaining < 0) {
        logger.warn('Rate limit exceeded', { ip, key });
        return ApiResult.error(c, '请求过于频繁，请稍后再试', 429);
      }
    } catch (err) {
      // Redis 不可用时降级放行，不阻断服务
      logger.warn('Rate limit check failed, bypassing', { error: String(err) });
    }

    await next();
  });
}
