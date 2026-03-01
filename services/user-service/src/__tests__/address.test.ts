/**
 * 地址管理 API 集成测试
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { app } from '../index';

const BASE = 'http://localhost';
const testEmail = `addr-${Date.now()}@example.com`;
const testPassword = 'password123';

let accessToken = '';
let addressIdA = '';
let addressIdB = '';

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

const authHeaders = () => ({ Authorization: `Bearer ${accessToken}` });

const addressA = {
  recipient: '张三',
  phone: '13800138000',
  province: '浙江省',
  city: '杭州市',
  district: '西湖区',
  address: '文三路 100 号',
  isDefault: true,
};

const addressB = {
  recipient: '李四',
  phone: '13900139000',
  province: '北京市',
  city: '北京市',
  district: '朝阳区',
  address: '建国路 88 号',
};

beforeAll(async () => {
  const res = await req('/api/v1/auth/register', {
    email: testEmail,
    password: testPassword,
  });
  const json = await res.json();
  accessToken = json.data.accessToken;
});

describe('Address API', () => {
  // 1. 空列表
  test('POST /api/v1/user/address/list — 空列表', async () => {
    const res = await req('/api/v1/user/address/list', undefined, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });

  // 2. 创建地址 A（第一个地址自动设为默认）
  test('POST /api/v1/user/address/create — 创建地址 A', async () => {
    const res = await req('/api/v1/user/address/create', addressA, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.recipient).toBe('张三');
    expect(json.data.isDefault).toBe(true);
    addressIdA = json.data.id;
  });

  // 3. 创建地址 B（A 仍为默认）
  test('POST /api/v1/user/address/create — 创建地址 B', async () => {
    const res = await req('/api/v1/user/address/create', addressB, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.isDefault).toBe(false);
    addressIdB = json.data.id;
  });

  // 4. 列表返回 2 条
  test('POST /api/v1/user/address/list — 返回 2 条', async () => {
    const res = await req('/api/v1/user/address/list', undefined, authHeaders());
    const json = await res.json();
    expect(json.data.length).toBe(2);
  });

  // 5. 更新 B 设为默认
  test('POST /api/v1/user/address/update — 更新 B 为默认', async () => {
    const res = await req('/api/v1/user/address/update', {
      id: addressIdB,
      isDefault: true,
    }, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.isDefault).toBe(true);

    // 验证 A 不再是默认
    const listRes = await req('/api/v1/user/address/list', undefined, authHeaders());
    const listJson = await listRes.json();
    const addrA = listJson.data.find((a: { id: string }) => a.id === addressIdA);
    expect(addrA.isDefault).toBe(false);
  });

  // 6. 删除 B（默认地址）→ A 自动变为默认
  test('POST /api/v1/user/address/delete — 删除默认地址', async () => {
    const res = await req('/api/v1/user/address/delete', { id: addressIdB }, authHeaders());
    expect(res.status).toBe(200);

    // A 应该自动变为默认
    const listRes = await req('/api/v1/user/address/list', undefined, authHeaders());
    const listJson = await listRes.json();
    expect(listJson.data.length).toBe(1);
    expect(listJson.data[0].id).toBe(addressIdA);
    expect(listJson.data[0].isDefault).toBe(true);
  });

  // 7. 地址上限测试（创建到 20 个，第 21 个应失败）
  test('POST /api/v1/user/address/create — 地址上限 20', async () => {
    // 已有 1 个，再创建 19 个
    for (let i = 0; i < 19; i++) {
      const res = await req('/api/v1/user/address/create', {
        ...addressB,
        recipient: `收件人${i}`,
      }, authHeaders());
      expect(res.status).toBe(200);
    }

    // 第 21 个应该失败
    const res = await req('/api/v1/user/address/create', {
      ...addressB,
      recipient: '超限收件人',
    }, authHeaders());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.meta.code).toBe('USER_1008');
  });
});
