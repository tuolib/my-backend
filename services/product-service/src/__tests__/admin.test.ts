/**
 * Admin API 集成测试
 * 商品/分类/SKU CRUD + 缓存失效 + 库存初始化
 * Phase 1: 商品管理补全（列表/详情/状态切换/SKU删除/图片管理）
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { app } from '../index';
import { redis } from '@repo/database';

const BASE = 'http://localhost';

// 签发测试用 admin token（type:'staff'）
let accessToken = '';

async function login(): Promise<string> {
  const { signAdminAccessToken } = await import('@repo/shared');
  return signAdminAccessToken({ sub: 'test-admin-id', username: 'admin', role: 'admin', isSuper: true });
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

  // ── Phase 1: 商品管理补全测试 ──

  // 9. Admin 商品列表（含所有状态）
  test('POST /api/v1/admin/product/list — 管理端商品列表', async () => {
    const res = await req('/api/v1/admin/product/list', {});
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items).toBeInstanceOf(Array);
    expect(json.data.pagination).toBeDefined();
    expect(json.data.pagination.total).toBeGreaterThanOrEqual(1);
  });

  // 10. Admin 商品列表 — 关键词搜索
  test('POST /api/v1/admin/product/list — 关键词搜索', async () => {
    const res = await req('/api/v1/admin/product/list', {
      keyword: '更新后',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items.length).toBeGreaterThanOrEqual(1);
    expect(json.data.items[0].title).toContain('更新后');
  });

  // 11. Admin 商品详情
  test('POST /api/v1/admin/product/detail — 管理端商品详情', async () => {
    const res = await req('/api/v1/admin/product/detail', { id: createdProductId });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe(createdProductId);
    expect(json.data.images).toBeInstanceOf(Array);
    expect(json.data.skus).toBeInstanceOf(Array);
    expect(json.data.categories).toBeInstanceOf(Array);
  });

  // 12. 切换商品状态 — 下架
  test('POST /api/v1/admin/product/toggle-status — 下架商品', async () => {
    const res = await req('/api/v1/admin/product/toggle-status', {
      id: createdProductId,
      status: 'draft',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('draft');
  });

  // 13. 切换商品状态 — 重新上架
  test('POST /api/v1/admin/product/toggle-status — 重新上架', async () => {
    const res = await req('/api/v1/admin/product/toggle-status', {
      id: createdProductId,
      status: 'active',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('active');
  });

  // 14. 添加商品图片
  test('POST /api/v1/admin/product/image/add — 添加图片', async () => {
    const res = await req('/api/v1/admin/product/image/add', {
      productId: createdProductId,
      images: [
        { url: 'https://placehold.co/800x800?text=Test2', altText: '测试图2' },
        { url: 'https://placehold.co/800x800?text=Test3', altText: '测试图3' },
      ],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    // 原有 1 张 + 新增 2 张 = 3 张
    expect(json.data.images.length).toBe(3);
  });

  // 15. 图片排序
  let imageIds: string[] = [];
  test('POST /api/v1/admin/product/image/sort — 图片排序', async () => {
    // 先获取当前图片
    const detailRes = await req('/api/v1/admin/product/detail', { id: createdProductId });
    const detailJson = await detailRes.json();
    imageIds = detailJson.data.images.map((img: any) => img.id);

    // 反转排序
    const reversed = [...imageIds].reverse();
    const res = await req('/api/v1/admin/product/image/sort', {
      productId: createdProductId,
      imageIds: reversed,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const sortedIds = json.data.images.map((img: any) => img.id);
    expect(sortedIds).toEqual(reversed);
  });

  // 16. 删除商品图片
  test('POST /api/v1/admin/product/image/delete — 删除图片', async () => {
    const imageIdToDelete = imageIds[imageIds.length - 1];
    const res = await req('/api/v1/admin/product/image/delete', {
      imageId: imageIdToDelete,
    });
    expect(res.status).toBe(200);

    // 确认图片数量减少
    const detailRes = await req('/api/v1/admin/product/detail', { id: createdProductId });
    const detailJson = await detailRes.json();
    expect(detailJson.data.images.length).toBe(imageIds.length - 1);
  });

  // 17. 删除不存在的图片 — 404
  test('POST /api/v1/admin/product/image/delete — 不存在返回 404', async () => {
    const res = await req('/api/v1/admin/product/image/delete', {
      imageId: 'nonexistent-image-id-xx',
    });
    expect(res.status).toBe(404);
  });

  // 18. 创建第二个 SKU，然后删除
  let secondSkuId = '';
  test('POST /api/v1/admin/product/sku/delete — 删除 SKU', async () => {
    // 先创建第二个 SKU
    const createRes = await req('/api/v1/admin/product/sku/create', {
      productId: createdProductId,
      skuCode: `TEST-SKU-DEL-${Date.now()}`,
      price: 99.99,
      stock: 20,
      attributes: { color: '蓝色', size: 'S' },
    });
    const createJson = await createRes.json();
    secondSkuId = createJson.data.id;

    // 删除 SKU
    const res = await req('/api/v1/admin/product/sku/delete', {
      skuId: secondSkuId,
    });
    expect(res.status).toBe(200);

    // 验证 Redis 库存已清除
    const stockStr = await redis.get(`stock:${secondSkuId}`);
    expect(stockStr).toBeNull();

    // 验证价格区间回到只有一个 SKU 的状态
    const detailRes = await req('/api/v1/admin/product/detail', { id: createdProductId });
    const detailJson = await detailRes.json();
    expect(detailJson.data.skus.length).toBe(1);
  });

  // 19. 删除不存在的 SKU — 404
  test('POST /api/v1/admin/product/sku/delete — 不存在返回 404', async () => {
    const res = await req('/api/v1/admin/product/sku/delete', {
      skuId: 'nonexistent-sku-id-xxxx',
    });
    expect(res.status).toBe(404);
  });

  // 20. 删除商品（放最后）
  test('POST /api/v1/admin/product/delete — 软删除 + 缓存清除', async () => {
    const res = await req('/api/v1/admin/product/delete', { id: createdProductId });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    // 再查详情应 404
    const detailRes = await pubReq('/api/v1/product/detail', { id: createdProductId });
    expect(detailRes.status).toBe(404);
  });

  // 21. 未认证请求 admin 路由
  test('POST /api/v1/admin/product/create — 未认证返回 401', async () => {
    const res = await app.request(`${BASE}/api/v1/admin/product/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'test', categoryIds: ['xxx'] }),
    });
    expect(res.status).toBe(401);
  });
});
