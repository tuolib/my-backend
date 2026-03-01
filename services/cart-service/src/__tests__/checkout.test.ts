/**
 * 结算预览 API 集成测试
 * 测试 checkout/preview 路由：金额计算 + 异常校验
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { app } from '../index';
import { app as userApp } from '../../../user-service/src/index';
import { app as productApp } from '../../../product-service/src/index';
import { redis } from '@repo/database';

const BASE = 'http://localhost';
const testEmail = `checkout-test-${Date.now()}@example.com`;
const testPassword = 'password123';

let accessToken = '';
let userId = '';
let activeSkuIds: string[] = [];
let skuPrices: Map<string, string> = new Map();

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

describe('Checkout Preview API', () => {
  beforeAll(async () => {
    // 注册测试用户
    const registerRes = await userReq('/api/v1/auth/register', {
      email: testEmail,
      password: testPassword,
      nickname: '结算测试用户',
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
      pageSize: 10,
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
          skuPrices.set(sku.id, sku.price);
        }
      }
    }

    expect(activeSkuIds.length).toBeGreaterThanOrEqual(2);

    // 添加 2 个商品到购物车
    await req('/api/v1/cart/add', { skuId: activeSkuIds[0], quantity: 2 }, authHeaders());
    await req('/api/v1/cart/add', { skuId: activeSkuIds[1], quantity: 1 }, authHeaders());
  });

  afterAll(async () => {
    if (userId) {
      await redis.del(`cart:${userId}`);
    }
  });

  // 1. 结算预览 — 正常情况
  test('POST /api/v1/cart/checkout/preview — 返回正确预览', async () => {
    const res = await req('/api/v1/cart/checkout/preview', undefined, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items).toBeDefined();
    expect(json.data.items.length).toBe(2);
    expect(json.data.summary).toBeDefined();
    expect(json.data.summary.itemsTotal).toBeDefined();
    expect(json.data.summary.payAmount).toBeDefined();
    expect(json.data.canCheckout).toBe(true);
    expect(json.data.warnings).toBeDefined();

    // 验证金额计算
    const price0 = parseFloat(json.data.items.find((i: any) => i.skuId === activeSkuIds[0])?.currentPrice ?? '0');
    const price1 = parseFloat(json.data.items.find((i: any) => i.skuId === activeSkuIds[1])?.currentPrice ?? '0');
    const expectedTotal = price0 * 2 + price1 * 1;
    expect(parseFloat(json.data.summary.itemsTotal)).toBeCloseTo(expectedTotal, 2);
    expect(json.data.summary.payAmount).toBe(json.data.summary.itemsTotal);
  });

  // 2. 没有勾选商品时结算预览 → 422
  test('POST /api/v1/cart/checkout/preview — 无勾选商品返回 422', async () => {
    // 取消所有选择
    await req('/api/v1/cart/select', {
      skuIds: [activeSkuIds[0], activeSkuIds[1]],
      selected: false,
    }, authHeaders());

    const res = await req('/api/v1/cart/checkout/preview', undefined, authHeaders());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);

    // 恢复选择
    await req('/api/v1/cart/select', {
      skuIds: [activeSkuIds[0], activeSkuIds[1]],
      selected: true,
    }, authHeaders());
  });

  // 3. 空购物车结算预览 → 422
  test('POST /api/v1/cart/checkout/preview — 空购物车返回 422', async () => {
    // 清空购物车
    await req('/api/v1/cart/clear', undefined, authHeaders());

    const res = await req('/api/v1/cart/checkout/preview', undefined, authHeaders());
    expect(res.status).toBe(422);

    // 恢复数据
    await req('/api/v1/cart/add', { skuId: activeSkuIds[0], quantity: 2 }, authHeaders());
    await req('/api/v1/cart/add', { skuId: activeSkuIds[1], quantity: 1 }, authHeaders());
  });
});
