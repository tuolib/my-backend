/**
 * 购物车 API 集成测试
 * 测试添加/列表/更新/删除/清空/选择 + 上限校验
 *
 * 前置：PG + Redis 运行中，种子数据已初始化
 * 通过 user-service 注册获取 token，通过 product-service 内部接口获取 SKU
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { app } from '../index';
import { app as userApp } from '../../../user-service/src/index';
import { app as productApp } from '../../../product-service/src/index';
import { redis } from '@repo/database';

const BASE = 'http://localhost';
const testEmail = `cart-test-${Date.now()}@example.com`;
const testPassword = 'password123';

let accessToken = '';
let activeSkuIds: string[] = [];

/** 发送请求到 cart-service */
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

/** 发送请求到 user-service */
function userReq(path: string, body?: unknown) {
  return userApp.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** 发送请求到 product-service */
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

describe('Cart API', () => {
  beforeAll(async () => {
    // 注册测试用户并获取 token
    const registerRes = await userReq('/api/v1/auth/register', {
      email: testEmail,
      password: testPassword,
      nickname: '购物车测试用户',
    });
    const registerJson = await registerRes.json();
    accessToken = registerJson.data.accessToken;

    // 获取可用的 SKU（从种子数据）
    const listRes = await productReq('/api/v1/product/list', {
      page: 1,
      pageSize: 10,
      filters: { status: 'active' },
    });
    const listJson = await listRes.json();
    const productIds = listJson.data.items.map((p: any) => p.id);

    // 获取每个商品的 SKU
    for (const pid of productIds) {
      const skuRes = await productReq('/api/v1/product/sku/list', { productId: pid });
      const skuJson = await skuRes.json();
      for (const sku of skuJson.data) {
        if (sku.status === 'active') {
          activeSkuIds.push(sku.id);
        }
      }
    }

    // 确保至少有 2 个 SKU
    expect(activeSkuIds.length).toBeGreaterThanOrEqual(2);
  });

  afterAll(async () => {
    // 清理测试购物车
    const userId = accessToken ? await getUserIdFromToken() : null;
    if (userId) {
      await redis.del(`cart:${userId}`);
    }
  });

  // 辅助：从 token 获取 userId
  async function getUserIdFromToken(): Promise<string | null> {
    const res = await userReq('/api/v1/user/profile', undefined);
    // 没有 auth header，这里直接用 cart-service 的 profile 不行
    // 通过 user-service 获取
    const profileRes = await userApp.request(`${BASE}/api/v1/user/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const json = await profileRes.json();
    return json.data?.id ?? null;
  }

  // 1. 购物车列表（空）
  test('POST /api/v1/cart/list — 空购物车返回 []', async () => {
    const res = await req('/api/v1/cart/list', undefined, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });

  // 2. 添加 SKU-A x 2
  test('POST /api/v1/cart/add — 添加商品成功', async () => {
    const res = await req('/api/v1/cart/add', {
      skuId: activeSkuIds[0],
      quantity: 2,
    }, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toBe('已加入购物车');
  });

  // 3. 添加 SKU-B x 1
  test('POST /api/v1/cart/add — 添加第二个商品', async () => {
    const res = await req('/api/v1/cart/add', {
      skuId: activeSkuIds[1],
      quantity: 1,
    }, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  // 4. 购物车列表 → 2 个商品
  test('POST /api/v1/cart/list — 返回 2 个商品', async () => {
    const res = await req('/api/v1/cart/list', undefined, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(2);

    // 检查第一个商品
    const item0 = json.data.find((i: any) => i.skuId === activeSkuIds[0]);
    expect(item0).toBeDefined();
    expect(item0.quantity).toBe(2);
    expect(item0.currentPrice).toBeDefined();
    expect(item0.snapshot).toBeDefined();
  });

  // 5. 再次添加 SKU-A x 3 → quantity 累加为 5
  test('POST /api/v1/cart/add — 同 SKU 累加数量', async () => {
    const res = await req('/api/v1/cart/add', {
      skuId: activeSkuIds[0],
      quantity: 3,
    }, authHeaders());
    expect(res.status).toBe(200);

    // 验证累加
    const listRes = await req('/api/v1/cart/list', undefined, authHeaders());
    const listJson = await listRes.json();
    const item = listJson.data.find((i: any) => i.skuId === activeSkuIds[0]);
    expect(item.quantity).toBe(5);
  });

  // 6. 更新 SKU-A quantity = 1
  test('POST /api/v1/cart/update — 更新数量', async () => {
    const res = await req('/api/v1/cart/update', {
      skuId: activeSkuIds[0],
      quantity: 1,
    }, authHeaders());
    expect(res.status).toBe(200);

    const listRes = await req('/api/v1/cart/list', undefined, authHeaders());
    const listJson = await listRes.json();
    const item = listJson.data.find((i: any) => i.skuId === activeSkuIds[0]);
    expect(item.quantity).toBe(1);
  });

  // 7. 更新 SKU-A quantity = 0 → 等同于删除
  test('POST /api/v1/cart/update — quantity=0 删除商品', async () => {
    const res = await req('/api/v1/cart/update', {
      skuId: activeSkuIds[0],
      quantity: 0,
    }, authHeaders());
    expect(res.status).toBe(200);

    const listRes = await req('/api/v1/cart/list', undefined, authHeaders());
    const listJson = await listRes.json();
    expect(listJson.data.length).toBe(1);
    expect(listJson.data[0].skuId).toBe(activeSkuIds[1]);
  });

  // 8. 更新不存在的 SKU → 404
  test('POST /api/v1/cart/update — 不存在的 SKU 返回 404', async () => {
    const res = await req('/api/v1/cart/update', {
      skuId: 'nonexistent-sku-id',
      quantity: 1,
    }, authHeaders());
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.meta.code).toBe('CART_3001');
  });

  // 9. 添加不存在的 SKU → 422
  test('POST /api/v1/cart/add — 不存在的 SKU 返回 422', async () => {
    const res = await req('/api/v1/cart/add', {
      skuId: 'nonexistent-sku-id',
      quantity: 1,
    }, authHeaders());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.meta.code).toBe('CART_3003');
  });

  // 10. 选择/取消选择
  test('POST /api/v1/cart/select — 取消选择', async () => {
    const res = await req('/api/v1/cart/select', {
      skuIds: [activeSkuIds[1]],
      selected: false,
    }, authHeaders());
    expect(res.status).toBe(200);

    const listRes = await req('/api/v1/cart/list', undefined, authHeaders());
    const listJson = await listRes.json();
    const item = listJson.data.find((i: any) => i.skuId === activeSkuIds[1]);
    expect(item.selected).toBe(false);
  });

  test('POST /api/v1/cart/select — 重新选择', async () => {
    const res = await req('/api/v1/cart/select', {
      skuIds: [activeSkuIds[1]],
      selected: true,
    }, authHeaders());
    expect(res.status).toBe(200);

    const listRes = await req('/api/v1/cart/list', undefined, authHeaders());
    const listJson = await listRes.json();
    const item = listJson.data.find((i: any) => i.skuId === activeSkuIds[1]);
    expect(item.selected).toBe(true);
  });

  // 11. 重新添加 SKU-A 然后批量删除
  test('POST /api/v1/cart/remove — 批量删除', async () => {
    // 先添加回来
    await req('/api/v1/cart/add', { skuId: activeSkuIds[0], quantity: 1 }, authHeaders());

    const res = await req('/api/v1/cart/remove', {
      skuIds: [activeSkuIds[0]],
    }, authHeaders());
    expect(res.status).toBe(200);

    const listRes = await req('/api/v1/cart/list', undefined, authHeaders());
    const listJson = await listRes.json();
    expect(listJson.data.length).toBe(1);
    expect(listJson.data[0].skuId).toBe(activeSkuIds[1]);
  });

  // 12. 清空购物车
  test('POST /api/v1/cart/clear — 清空购物车', async () => {
    const res = await req('/api/v1/cart/clear', undefined, authHeaders());
    expect(res.status).toBe(200);

    const listRes = await req('/api/v1/cart/list', undefined, authHeaders());
    const listJson = await listRes.json();
    expect(listJson.data).toEqual([]);
  });

  // 13. 无 token 访问 → 401
  test('POST /api/v1/cart/list — 无 token 返回 401', async () => {
    const res = await req('/api/v1/cart/list');
    expect(res.status).toBe(401);
  });

  // 14. 参数校验
  test('POST /api/v1/cart/add — 缺少 skuId 返回 422', async () => {
    const res = await req('/api/v1/cart/add', {
      quantity: 1,
    }, authHeaders());
    expect(res.status).toBe(422);
  });

  test('POST /api/v1/cart/add — quantity 为负数返回 422', async () => {
    const res = await req('/api/v1/cart/add', {
      skuId: activeSkuIds[0],
      quantity: -1,
    }, authHeaders());
    expect(res.status).toBe(422);
  });
});
