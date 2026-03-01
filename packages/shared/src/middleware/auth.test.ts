/**
 * auth 中间件测试
 * 使用 mock Redis（Map 模拟）
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { Hono } from 'hono';
import type { AppEnv } from '../types/context';
import { requestId } from './request-id';
import { errorHandler } from './error-handler';
import { createAuthMiddleware } from './auth';
import { signAccessToken } from '../utils/jwt';

// 设置测试环境变量
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-key-min-16';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-min-16';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
});

/** 简单的 mock Redis，用 Map 模拟 get */
function createMockRedis(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async () => 'OK',
  } as any;
}

function createApp(redis: any) {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.onError(errorHandler);
  app.get('/protected', createAuthMiddleware(redis), (c) => {
    return c.json({
      userId: c.get('userId'),
      userEmail: c.get('userEmail'),
      tokenJti: c.get('tokenJti'),
    });
  });
  return app;
}

describe('auth middleware', () => {
  test('合法 token + 不在黑名单 → 通过，userId 被注入', async () => {
    const redis = createMockRedis();
    const app = createApp(redis);

    const token = await signAccessToken({
      sub: 'user-123',
      email: 'test@example.com',
    });

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.userId).toBe('user-123');
    expect(body.userEmail).toBe('test@example.com');
    expect(body.tokenJti).toBeTruthy();
  });

  test('合法 token + 在黑名单 → 401 TOKEN_REVOKED', async () => {
    // 先签发 token 拿到 jti
    const token = await signAccessToken({
      sub: 'user-123',
      email: 'test@example.com',
    });

    // 解码 token 获取 jti
    const parts = token.split('.');
    const payload = JSON.parse(atob(parts[1]));
    const jti = payload.jti;

    const redis = createMockRedis({
      [`user:session:blacklist:${jti}`]: '1',
    });
    const app = createApp(redis);

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.meta.code).toBe('USER_1005'); // TOKEN_REVOKED
  });

  test('无 token → 401', async () => {
    const redis = createMockRedis();
    const app = createApp(redis);

    const res = await app.request('/protected');

    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test('无效 token → 401', async () => {
    const redis = createMockRedis();
    const app = createApp(redis);

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer invalid-token' },
    });

    expect(res.status).toBe(401);
  });
});
