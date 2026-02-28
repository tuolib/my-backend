/**
 * 内部接口集成测试
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { app } from '../index';

const BASE = 'http://localhost';
const testEmail = `internal-${Date.now()}@example.com`;
const testPassword = 'password123';

let userId = '';

function req(path: string, body?: unknown) {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeAll(async () => {
  const res = await req('/api/v1/auth/register', {
    email: testEmail,
    password: testPassword,
  });
  const json = await res.json();
  userId = json.data.user.id;
});

describe('Internal API', () => {
  test('POST /internal/user/detail — 获取用户信息', async () => {
    const res = await req('/internal/user/detail', { id: userId });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe(userId);
    expect(json.data.email).toBe(testEmail);
    expect(json.data.password).toBeUndefined();
  });

  test('POST /internal/user/batch — 批量获取', async () => {
    const res = await req('/internal/user/batch', { ids: [userId] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].id).toBe(userId);
    expect(json.data[0].password).toBeUndefined();
  });

  test('POST /internal/user/detail — 不存在的用户返回 404', async () => {
    const res = await req('/internal/user/detail', { id: 'nonexistent-id-12345' });
    expect(res.status).toBe(404);
  });

  test('POST /internal/user/batch — 空数组返回空', async () => {
    const res = await req('/internal/user/batch', { ids: [] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });
});
