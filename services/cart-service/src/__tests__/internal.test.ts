/**
 * 内部接口集成测试
 * 测试 /internal/cart/clear-items
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { app } from '../index';
import { app as userApp } from '../../../user-service/src/index';
import { app as productApp } from '../../../product-service/src/index';
import { redis } from '@repo/database';

const BASE = 'http://localhost';
const testEmail = `internal-cart-test-${Date.now()}@example.com`;
const testPassword = 'password123';

let accessToken = '';
let userId = '';
let activeSkuIds: string[] = [];

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

function userReq(path: string, body?: unknown, headers?: Record<string, string>) {
  return userApp.request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function productReq(path: string, body?: unknown) {
  return productApp.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function authHeaders() {
  return { Authorization: `Bearer ${accessToken}` };
}

describe('Internal Cart API', () => {
  beforeAll(async () => {
    // 注册测试用户
    const registerRes = await userReq('/api/v1/auth/register', {
      email: testEmail,
      password: testPassword,
      nickname: '内部接口测试用户',
    });
    const registerJson = await registerRes.json();
    accessToken = registerJson.data.accessToken;

    // 获取 userId
    const profileRes = await userReq('/api/v1/user/profile', undefined, {
      Authorization: `Bearer ${accessToken}`,
    });
    const profileJson = await profileRes.json();
    userId = profileJson.data.id;

    // 获取可用 SKU
    const listRes = await productReq('/api/v1/product/list', {
      page: 1,
      pageSize: 5,
      filters: { status: 'active' },
    });
    const listJson = await listRes.json();

    for (const product of listJson.data.items) {
      const skuRes = await productReq('/api/v1/product/sku/list', {
        productId: product.id,
      });
      const skuJson = await skuRes.json();
      for (const sku of skuJson.data) {
        if (sku.status === 'active') {
          activeSkuIds.push(sku.id);
        }
      }
      if (activeSkuIds.length >= 2) break;
    }

    expect(activeSkuIds.length).toBeGreaterThanOrEqual(2);

    // 添加 2 个商品到购物车
    await req('/api/v1/cart/add', { skuId: activeSkuIds[0], quantity: 1 }, authHeaders());
    await req('/api/v1/cart/add', { skuId: activeSkuIds[1], quantity: 1 }, authHeaders());
  });

  afterAll(async () => {
    if (userId) {
      await redis.del(`cart:${userId}`);
    }
  });

  // 1. 清理指定 SKU，保留其他
  test('POST /internal/cart/clear-items — 清理部分 SKU', async () => {
    const res = await req('/internal/cart/clear-items', {
      userId,
      skuIds: [activeSkuIds[0]],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    // 验证 SKU-A 被移除，SKU-B 还在
    const listRes = await req('/api/v1/cart/list', undefined, authHeaders());
    const listJson = await listRes.json();
    expect(listJson.data.length).toBe(1);
    expect(listJson.data[0].skuId).toBe(activeSkuIds[1]);
  });

  // 2. 用户不存在的 cart → 静默成功
  test('POST /internal/cart/clear-items — 不存在的购物车静默成功', async () => {
    const res = await req('/internal/cart/clear-items', {
      userId: 'nonexistent-user-id',
      skuIds: ['some-sku-id'],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  // 3. skuId 不在 cart 中 → 静默成功
  test('POST /internal/cart/clear-items — 不存在的 SKU 静默成功', async () => {
    const res = await req('/internal/cart/clear-items', {
      userId,
      skuIds: ['nonexistent-sku-id'],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
