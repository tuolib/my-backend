/**
 * Redis 滑动窗口限流测试
 * 验证匿名/认证请求的频率限制
 * 注意：rate-limit 在 auth 之前运行，使用 IP + Authorization header 判断
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { app } from '../app';
import { signAccessToken, generateId } from '@repo/shared';
import { redis } from '@repo/database';

/** 发送 POST 请求 */
async function post(
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** 清理限流 Redis keys */
async function clearRateLimitKeys() {
  const keys = await redis.keys('gateway:ratelimit:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

describe('Rate Limiting', () => {
  beforeEach(async () => {
    await clearRateLimitKeys();
  });

  test('匿名请求包含 X-RateLimit-Limit 和 X-RateLimit-Remaining headers', async () => {
    const res = await post('/api/v1/product/list', { page: 1, pageSize: 10 });
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
    const remaining = Number(res.headers.get('X-RateLimit-Remaining'));
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(100);
  });

  test('带 Authorization header 的请求限制为 200/min', async () => {
    const token = await signAccessToken({
      sub: generateId(),
      email: 'ratetest@example.com',
    });

    const res = await post('/api/v1/cart/list', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.headers.get('X-RateLimit-Limit')).toBe('200');
  });

  test('超过匿名限制后返回 429', async () => {
    // 用固定 IP key 预填充 100 条请求记录
    const testKey = 'gateway:ratelimit:ip:127.0.0.1';
    const now = Date.now();

    const pipeline = redis.pipeline();
    for (let i = 0; i < 100; i++) {
      pipeline.zadd(testKey, now - i, `${now - i}:${generateId()}`);
    }
    pipeline.pexpire(testKey, 60_000);
    await pipeline.exec();

    // 第 101 次请求应该被拒绝
    const res = await post('/api/v1/product/list', { page: 1, pageSize: 10 });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.success).toBe(false);

    // 应该包含 Retry-After header
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();

    // X-RateLimit-Remaining 应该为 0
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  test('Remaining 正确递减', async () => {
    const res1 = await post('/api/v1/product/list', { page: 1, pageSize: 10 });
    const remaining1 = Number(res1.headers.get('X-RateLimit-Remaining'));

    const res2 = await post('/api/v1/product/list', { page: 1, pageSize: 10 });
    const remaining2 = Number(res2.headers.get('X-RateLimit-Remaining'));

    expect(remaining2).toBe(remaining1 - 1);
  });
});
