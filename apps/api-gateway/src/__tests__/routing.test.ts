/**
 * 路由转发测试 — 验证 Gateway 正确分发请求到下游服务
 * 前置：所有下游服务运行中
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { app } from '../app';
import { getConfig, signAccessToken, generateId } from '@repo/shared';

const GATEWAY = 'http://localhost';

/** 创建测试用 JWT token */
async function createTestToken(): Promise<string> {
  return signAccessToken({
    sub: generateId(),
    email: `test-${Date.now()}@example.com`,
  });
}

/** 发送 POST 请求到 gateway */
async function post(
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<Response> {
  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };
  return app.request(path, {
    method: 'POST',
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('Gateway Routing', () => {
  test('POST /api/v1/nonexistent（无 token）→ 401', async () => {
    // 非公开路由，auth gate 先于路由匹配
    const res = await post('/api/v1/nonexistent');
    expect(res.status).toBe(401);
  });

  test('POST /api/v1/nonexistent（有 token）→ 404', async () => {
    const token = await createTestToken();
    const res = await post('/api/v1/nonexistent', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  test('POST /internal/user/detail → 403 (外部不可访问)', async () => {
    const res = await post('/internal/user/detail', { id: 'test' });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toContain('Internal API');
  });

  test('响应中包含 X-Request-Id header', async () => {
    const res = await post('/api/v1/product/list', { page: 1, pageSize: 10 });
    const requestId = res.headers.get('X-Request-Id');
    expect(requestId).toBeTruthy();
    expect(typeof requestId).toBe('string');
  });

  test('传入 X-Request-Id 时保留原值', async () => {
    const customId = `test-trace-${Date.now()}`;
    const res = await post('/api/v1/product/list', { page: 1, pageSize: 10 }, {
      'X-Request-Id': customId,
    });
    expect(res.headers.get('X-Request-Id')).toBe(customId);
  });

  test('POST /api/v1/auth/login → 转发到 user-service', async () => {
    const res = await post('/api/v1/auth/login', {
      email: 'nonexistent@test.com',
      password: 'wrongpassword',
    });
    // 即使登录失败，也证明转发成功（返回的是业务错误而非 404）
    expect([200, 401, 422]).toContain(res.status);
  });

  test('POST /api/v1/product/list → 转发到 product-service', async () => {
    const res = await post('/api/v1/product/list', { page: 1, pageSize: 10 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('POST /api/v1/category/tree → 转发到 product-service', async () => {
    const res = await post('/api/v1/category/tree');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('POST /api/v1/cart/list（带 token）→ 转发到 cart-service', async () => {
    const token = await createTestToken();
    const res = await post('/api/v1/cart/list', undefined, {
      Authorization: `Bearer ${token}`,
    });
    // cart-service 应该正常响应（即使购物车为空）
    expect(res.status).toBe(200);
  });

  test('POST /api/v1/order/list（带 token）→ 转发到 order-service', async () => {
    const token = await createTestToken();
    const res = await post('/api/v1/order/list', { page: 1, pageSize: 10 }, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
  });

  test('POST /api/v1/admin/order/list（带 token）→ 转发到 order-service', async () => {
    const token = await createTestToken();
    const res = await post('/api/v1/admin/order/list', { page: 1, pageSize: 10 }, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
  });

  test('POST / → 401（非公开路由，需认证）', async () => {
    const res = await app.request('/', { method: 'POST' });
    // / 不在公开路由列表中，auth gate 先返回 401
    expect(res.status).toBe(401);
  });

  test('POST /（有 token）→ 404', async () => {
    const token = await createTestToken();
    const res = await app.request('/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
