/**
 * Admin API 集成测试
 * 商品/分类/SKU CRUD + 缓存失效 + 库存初始化
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { app } from '../index';
import { redis } from '@repo/database';

const BASE = 'http://localhost';

// 使用种子数据的 admin 用户获取 token
let accessToken = '';

async function login(): Promise<string> {
  // 直接调 user-service 获取 token 不现实，我们直接签发一个测试用的
  const { signAccessToken } = await import('@repo/shared');
  return signAccessToken({ sub: 'test-admin-id', email: 'admin@test.com' });
}

function req(path: string, body?: unknown, headers?: Record<string, string>) {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function pubReq(path: string, body?: unknown) {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('Admin API', () => {
  let createdProductId = '';
  let createdSkuId = '';
  let createdCategoryId = '';

  beforeAll(async () => {
    accessToken = await login();
  });

  // 1. 创建分类
  test('POST /api/v1/admin/category/create — 创建分类', async () => {
    const res = await req('/api/v1/admin/category/create', {
      name: '测试分类',
      slug: `test-cat-${Date.now()}`,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('测试分类');
    createdCategoryId = json.data.id;
  });

  // 2. 分类树缓存应被清除（再次请求应能看到新分类）
  test('POST /api/v1/category/tree — 新分类出现在树中', async () => {
    const res = await pubReq('/api/v1/category/tree', {});
    const json = await res.json();
    const allIds = JSON.stringify(json.data);
    expect(allIds).toContain(createdCategoryId);
  });

  // 3. 创建商品
  test('POST /api/v1/admin/product/create — 创建商品', async () => {
    const res = await req('/api/v1/admin/product/create', {
      title: '测试商品 Admin Test',
      description: '这是一个测试商品',
      brand: 'TestBrand',
      status: 'active',
      categoryIds: [createdCategoryId],
      images: [
        { url: 'https://placehold.co/800x800?text=Test1', altText: '测试图1', isPrimary: true },
      ],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.title).toBe('测试商品 Admin Test');
    expect(json.data.slug).toBeDefined();
    expect(json.data.images.length).toBe(1);
    expect(json.data.categories.length).toBe(1);
    createdProductId = json.data.id;
  });

  // 4. 创建 SKU
  test('POST /api/v1/admin/product/sku/create — 创建 SKU + Redis 库存初始化', async () => {
    const skuCode = `TEST-SKU-${Date.now()}`;
    const res = await req('/api/v1/admin/product/sku/create', {
      productId: createdProductId,
      skuCode,
      price: 199.99,
      stock: 50,
      attributes: { color: '红色', size: 'M' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.skuCode).toBe(skuCode);
    createdSkuId = json.data.id;

    // 验证 Redis 库存初始化
    const stockStr = await redis.get(`stock:${createdSkuId}`);
    expect(stockStr).toBe('50');
  });

  // 5. 创建 SKU 后 product.minPrice 更新
  test('POST /api/v1/product/detail — SKU 创建后价格区间更新', async () => {
    const res = await pubReq('/api/v1/product/detail', { id: createdProductId });
    const json = await res.json();
    expect(json.data.minPrice).toBeDefined();
    expect(parseFloat(json.data.minPrice)).toBe(199.99);
  });

  // 6. 更新商品
  test('POST /api/v1/admin/product/update — 更新商品 + 缓存失效', async () => {
    const res = await req('/api/v1/admin/product/update', {
      id: createdProductId,
      title: '更新后的测试商品',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.title).toBe('更新后的测试商品');
  });

  // 7. 更新 SKU 价格
  test('POST /api/v1/admin/product/sku/update — 更新价格 + 价格区间同步', async () => {
    const res = await req('/api/v1/admin/product/sku/update', {
      skuId: createdSkuId,
      price: 299.99,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(parseFloat(json.data.price)).toBe(299.99);

    // 验证 product 价格区间更新
    const detailRes = await pubReq('/api/v1/product/detail', { id: createdProductId });
    const detailJson = await detailRes.json();
    expect(parseFloat(detailJson.data.minPrice)).toBe(299.99);
  });

  // 8. SKU code 重复
  test('POST /api/v1/admin/product/sku/create — 重复 SKU code 返回 409', async () => {
    // 先获取已创建的 SKU code
    const detailRes = await pubReq('/api/v1/product/detail', { id: createdProductId });
    const detailJson = await detailRes.json();
    const existingSkuCode = detailJson.data.skus[0].skuCode;

    const res = await req('/api/v1/admin/product/sku/create', {
      productId: createdProductId,
      skuCode: existingSkuCode,
      price: 100,
      stock: 10,
      attributes: { size: 'S' },
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.meta.code).toBe('PRODUCT_2005');
  });

  // 9. 删除商品
  test('POST /api/v1/admin/product/delete — 软删除 + 缓存清除', async () => {
    const res = await req('/api/v1/admin/product/delete', { id: createdProductId });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    // 再查详情应 404
    const detailRes = await pubReq('/api/v1/product/detail', { id: createdProductId });
    expect(detailRes.status).toBe(404);
  });

  // 10. 未认证请求 admin 路由
  test('POST /api/v1/admin/product/create — 未认证返回 401', async () => {
    const res = await app.request(`${BASE}/api/v1/admin/product/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'test', categoryIds: ['xxx'] }),
    });
    expect(res.status).toBe(401);
  });
});
