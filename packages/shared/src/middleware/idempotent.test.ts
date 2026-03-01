/**
 * idempotent 中间件测试
 * 使用 mock Redis（Map 模拟）
 */
import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import type { AppEnv } from '../types/context';
import { requestId } from './request-id';
import { createIdempotentMiddleware } from './idempotent';

/** Mock Redis，用 Map 模拟 get/set */
function createMockRedis(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
    _store: store,
  } as any;
}

function createApp(redis: any) {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.post('/order', createIdempotentMiddleware(redis), (c) => {
    return c.json({ orderId: 'order-001', status: 'created' });
  });
  return app;
}

describe('idempotent middleware', () => {
  test('无 X-Idempotency-Key → 直接通过', async () => {
    const redis = createMockRedis();
    const app = createApp(redis);

    const res = await app.request('/order', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.orderId).toBe('order-001');
  });

  test('有 key + Redis 不存在 → 通过 + 响应后写入 Redis', async () => {
    const redis = createMockRedis();
    const app = createApp(redis);

    const res = await app.request('/order', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': 'unique-key-123' },
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.orderId).toBe('order-001');

    // 验证已写入 Redis
    const stored = redis._store.get('order:idempotent:unique-key-123');
    expect(stored).toBeTruthy();
  });

  test('有 key + Redis 存在 → 409 IDEMPOTENT_CONFLICT', async () => {
    const originalResponse = JSON.stringify({
      orderId: 'order-001',
      status: 'created',
    });
    const redis = createMockRedis({
      'order:idempotent:duplicate-key': originalResponse,
    });
    const app = createApp(redis);

    const res = await app.request('/order', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': 'duplicate-key' },
    });

    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe(409);
    expect(body.meta.code).toBe('ORDER_4007'); // IDEMPOTENT_CONFLICT
  });
});
