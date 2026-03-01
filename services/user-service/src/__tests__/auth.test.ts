/**
 * 认证 API 集成测试
 * 测试注册 → 登录 → refresh → 登出 完整流程
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { app } from '../index';

const BASE = 'http://localhost';
const testEmail = `test-${Date.now()}@example.com`;
const testPassword = 'password123';

let accessToken = '';
let refreshToken = '';
let tokenJti = '';

function req(path: string, body?: unknown, headers?: Record<string, string>) {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('Auth API', () => {
  // 1. 注册成功
  test('POST /api/v1/auth/register — 注册成功', async () => {
    const res = await req('/api/v1/auth/register', {
      email: testEmail,
      password: testPassword,
      nickname: '测试用户',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.user.email).toBe(testEmail);
    expect(json.data.user.nickname).toBe('测试用户');
    expect(json.data.user.password).toBeUndefined();
    expect(json.data.accessToken).toBeDefined();
    expect(json.data.refreshToken).toBeDefined();

    accessToken = json.data.accessToken;
    refreshToken = json.data.refreshToken;
  });

  // 2. 重复邮箱注册
  test('POST /api/v1/auth/register — 重复邮箱注册返回 409', async () => {
    const res = await req('/api/v1/auth/register', {
      email: testEmail,
      password: testPassword,
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.meta.code).toBe('USER_1002');
  });

  // 3. 登录成功
  test('POST /api/v1/auth/login — 登录成功', async () => {
    const res = await req('/api/v1/auth/login', {
      email: testEmail,
      password: testPassword,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.user.email).toBe(testEmail);
    expect(json.data.accessToken).toBeDefined();
    expect(json.data.refreshToken).toBeDefined();

    // 更新 token 用于后续测试
    accessToken = json.data.accessToken;
    refreshToken = json.data.refreshToken;
  });

  // 4. 登录密码错误
  test('POST /api/v1/auth/login — 密码错误返回 401', async () => {
    const res = await req('/api/v1/auth/login', {
      email: testEmail,
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.meta.code).toBe('USER_1003');
  });

  // 5. 登录邮箱不存在（返回同一错误码）
  test('POST /api/v1/auth/login — 邮箱不存在返回 401', async () => {
    const res = await req('/api/v1/auth/login', {
      email: 'nonexistent@example.com',
      password: testPassword,
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.meta.code).toBe('USER_1003');
  });

  // 6. refresh token 换新
  test('POST /api/v1/auth/refresh — 刷新 token 成功', async () => {
    const res = await req('/api/v1/auth/refresh', {
      refreshToken,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.accessToken).toBeDefined();
    expect(json.data.refreshToken).toBeDefined();

    const oldRefreshToken = refreshToken;
    accessToken = json.data.accessToken;
    refreshToken = json.data.refreshToken;

    // 7. 旧 refresh token 再用应失败（Token Rotation）
    const res2 = await req('/api/v1/auth/refresh', {
      refreshToken: oldRefreshToken,
    });
    expect(res2.status).toBe(401);
  });

  // 8. 用 access token 访问需认证接口
  test('POST /api/v1/user/profile — 获取用户信息', async () => {
    const res = await req('/api/v1/user/profile', undefined, {
      Authorization: `Bearer ${accessToken}`,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.email).toBe(testEmail);
    expect(json.data.password).toBeUndefined();
  });

  // 9. 登出
  test('POST /api/v1/auth/logout — 登出成功', async () => {
    const res = await req('/api/v1/auth/logout', { refreshToken }, {
      Authorization: `Bearer ${accessToken}`,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  // 10. 登出后用旧 access token 访问应失败（JTI 黑名单）
  test('POST /api/v1/user/profile — 登出后旧 token 失效', async () => {
    const res = await req('/api/v1/user/profile', undefined, {
      Authorization: `Bearer ${accessToken}`,
    });
    expect(res.status).toBe(401);
  });

  // 无认证访问需认证接口
  test('POST /api/v1/user/profile — 无 token 返回 401', async () => {
    const res = await req('/api/v1/user/profile');
    expect(res.status).toBe(401);
  });
});
