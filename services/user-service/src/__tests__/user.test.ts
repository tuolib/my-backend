/**
 * 用户资料 API 集成测试
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { app } from '../index';

const BASE = 'http://localhost';
const testEmail = `user-${Date.now()}@example.com`;
const testPassword = 'password123';

let accessToken = '';

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

beforeAll(async () => {
  // 注册+登录获取 token
  const res = await req('/api/v1/auth/register', {
    email: testEmail,
    password: testPassword,
    nickname: '资料测试',
  });
  const json = await res.json();
  accessToken = json.data.accessToken;
});

describe('User Profile API', () => {
  test('POST /api/v1/user/profile — 获取 profile', async () => {
    const res = await req('/api/v1/user/profile', undefined, {
      Authorization: `Bearer ${accessToken}`,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.email).toBe(testEmail);
    expect(json.data.nickname).toBe('资料测试');
    expect(json.data.password).toBeUndefined();
  });

  test('POST /api/v1/user/update — 更新 nickname', async () => {
    const res = await req('/api/v1/user/update', { nickname: '新昵称' }, {
      Authorization: `Bearer ${accessToken}`,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.nickname).toBe('新昵称');
  });

  test('POST /api/v1/user/update — 空 body 不报错', async () => {
    const res = await req('/api/v1/user/update', {}, {
      Authorization: `Bearer ${accessToken}`,
    });
    expect(res.status).toBe(200);
  });
});
