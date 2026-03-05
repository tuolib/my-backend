/**
 * 鉴权网关测试 — 验证公开/认证路由的 auth 行为
 */
import { describe, test, expect } from 'bun:test';
import { app } from '../app';
import { signAccessToken, verifyAccessToken, generateId } from '@repo/shared';
import { redis } from '@repo/database';

/** 创建测试用 JWT token，返回 token 和实际 jti */
async function createTestToken(): Promise<{
  token: string;
  jti: string;
  sub: string;
}> {
  const sub = generateId();
  const token = await signAccessToken({
    sub,
    email: `test-${Date.now()}@example.com`,
  });
  // signAccessToken 内部生成 jti，需要从 token 中解析出来
  const payload = await verifyAccessToken(token);
  return { token, jti: payload.jti, sub: payload.sub };
}

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

describe('Auth Gate', () => {
  test('公开路由（/auth/login）无 token → 正常转发', async () => {
    const res = await post('/api/v1/auth/login', {
      email: 'test@test.com',
      password: 'testpassword',
    });
    // auth gate 跳过了鉴权，请求到达了 user-service
    // user-service 返回 401（无效凭证）是业务错误，不是 auth gate 拒绝
    const json = await res.json();
    expect(json.meta?.code).toBe('USER_1003'); // INVALID_CREDENTIALS
  });

  test('公开路由（/product/list）无 token → 正常转发', async () => {
    const res = await post('/api/v1/product/list', { page: 1, pageSize: 10 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('公开路由（/category/tree）无 token → 正常转发', async () => {
    const res = await post('/api/v1/category/tree');
    expect(res.status).toBe(200);
  });

  test('认证路由（/cart/list）无 token → 401', async () => {
    const res = await post('/api/v1/cart/list');
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  test('认证路由（/order/list）无 token → 401', async () => {
    const res = await post('/api/v1/order/list', { page: 1, pageSize: 10 });
    expect(res.status).toBe(401);
  });

  test('认证路由（/cart/list）有效 token → 正常转发', async () => {
    const { token } = await createTestToken();
    const res = await post('/api/v1/cart/list', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
  });

  test('认证路由 token 格式错误 → 401', async () => {
    const res = await post('/api/v1/cart/list', undefined, {
      Authorization: 'Bearer invalid-token-here',
    });
    expect(res.status).toBe(401);
  });

  test('认证路由 token 在黑名单 → 401', async () => {
    const { token, jti } = await createTestToken();

    // 将 token 加入黑名单
    await redis.set(`user:session:blacklist:${jti}`, '1', 'EX', 60);

    const res = await post('/api/v1/cart/list', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(401);

    // 清理
    await redis.del(`user:session:blacklist:${jti}`);
  });

  test('公开路由 /payment/notify 无 token → 正常转发', async () => {
    const res = await post('/api/v1/payment/notify', {
      orderId: 'fake-order-id',
      transactionId: 'fake-tx-id',
      status: 'success',
      amount: 100,
      method: 'mock',
    });
    // 不是 401，说明通过了 auth gate
    expect(res.status).not.toBe(401);
  });

  // Admin 路由跳过 C 端 JWT 鉴权（由下游服务自行验证 admin token）
  test('admin 路由（/admin/auth/login）无 C 端 token → 跳过 auth gate', async () => {
    const res = await post('/api/v1/admin/auth/login', {
      username: 'nonexistent',
      password: 'test',
    });
    // 不是 gateway 层 401，而是下游 user-service 返回的业务 401
    const json = await res.json();
    expect(json.meta?.code).toBe('ADMIN_5002');
  });

  test('admin 路由（/admin/product/create）无 token → 下游服务返回 401', async () => {
    const res = await post('/api/v1/admin/product/create', {
      title: 'test',
      categoryIds: ['xxx'],
    });
    // auth gate 跳过了 C 端鉴权，但 product-service 的 adminAuthMiddleware 拒绝
    expect(res.status).toBe(401);
  });

  test('admin 路由 admin token → 正常转发到下游服务', async () => {
    const { signAdminAccessToken } = await import('@repo/shared');
    const adminToken = await signAdminAccessToken({
      sub: 'test-admin',
      username: 'admin',
      role: 'admin',
      isSuper: true,
    });
    const res = await post('/api/v1/admin/auth/profile', undefined, {
      Authorization: `Bearer ${adminToken}`,
    });
    // 通过了 auth gate，到达了 user-service，可能返回 404（test-admin 不存在于 DB）
    // 但不是 gateway 层的 401
    expect(res.status).not.toBe(401);
  });
});
