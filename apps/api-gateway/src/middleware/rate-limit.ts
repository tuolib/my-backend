/**
 * Redis 滑动窗口限流中间件
 * 运行在 auth 之前，因此通过 Authorization header 判断请求类型：
 * - 有 Authorization header：200 req/min (IP 维度，对认证用户更宽松)
 * - 无 Authorization header：100 req/min (IP 维度)
 * - 支付回调路径：500 req/min (IP 维度)
 * 使用 Redis ZSET 实现精确滑动窗口
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '@repo/shared';
import { redis } from '@repo/database';
import { RateLimitError, ErrorCode } from '@repo/shared';
import { generateId } from '@repo/shared';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const LIMITS: Record<string, RateLimitConfig> = {
  anonymous: { windowMs: 60_000, maxRequests: 100 },
  authenticated: { windowMs: 60_000, maxRequests: 200 },
  paymentNotify: { windowMs: 60_000, maxRequests: 500 },
};

/** 获取客户端真实 IP */
function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '127.0.0.1'
  );
}

export function rateLimitMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const path = c.req.path;
    const ip = getClientIp(c);
    const hasAuth = !!c.req.header('Authorization');

    // 确定限流配置和 key（rate-limit 在 auth 之前运行，使用 IP 维度）
    let config: RateLimitConfig;
    let key: string;

    if (path === '/api/v1/payment/notify') {
      config = LIMITS.paymentNotify;
      key = `gateway:ratelimit:payment-notify:${ip}`;
    } else if (hasAuth) {
      config = LIMITS.authenticated;
      key = `gateway:ratelimit:auth:${ip}`;
    } else {
      config = LIMITS.anonymous;
      key = `gateway:ratelimit:ip:${ip}`;
    }

    const now = Date.now();
    const windowStart = now - config.windowMs;
    const member = `${now}:${generateId()}`;

    // Redis 滑动窗口：原子 pipeline 操作
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart); // 移除窗口外记录
    pipeline.zadd(key, now, member);                // 添加当前请求
    pipeline.zcard(key);                             // 统计窗口内请求数
    pipeline.pexpire(key, config.windowMs);          // 设置过期

    const results = await pipeline.exec();
    const count = (results?.[2]?.[1] as number) ?? 0;
    const remaining = Math.max(0, config.maxRequests - count);

    // 设置限流响应 headers
    c.header('X-RateLimit-Limit', String(config.maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));

    if (count > config.maxRequests) {
      const retryAfter = Math.ceil(config.windowMs / 1000);
      c.header('Retry-After', String(retryAfter));
      throw new RateLimitError(
        '请求过于频繁，请稍后再试',
        ErrorCode.RATE_LIMITED
      );
    }

    await next();
  };
}
