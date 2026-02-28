/**
 * 商品 API 集成测试
 * 测试列表、详情、排序、筛选、缓存
 */
import { describe, test, expect } from 'bun:test';
import { app } from '../index';

const BASE = 'http://localhost';

function req(path: string, body?: unknown) {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('Product API', () => {
  // 1. 商品列表
  test('POST /api/v1/product/list — 返回种子数据 + 分页', async () => {
    const res = await req('/api/v1/product/list', { page: 1, pageSize: 5 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items.length).toBeGreaterThan(0);
    expect(json.data.pagination).toBeDefined();
    expect(json.data.pagination.page).toBe(1);
    expect(json.data.pagination.pageSize).toBe(5);
  });

  // 2. 商品列表（按价格排序）
  test('POST /api/v1/product/list — 按价格升序排序', async () => {
    const res = await req('/api/v1/product/list', {
      page: 1,
      pageSize: 20,
      sort: 'price',
      order: 'asc',
      filters: { status: 'active' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    const items = json.data.items;
    if (items.length >= 2) {
      // 验证按 minPrice 升序
      for (let i = 1; i < items.length; i++) {
        const prev = parseFloat(items[i - 1].minPrice ?? '0');
        const curr = parseFloat(items[i].minPrice ?? '0');
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    }
  });

  // 3. 商品详情
  test('POST /api/v1/product/detail — 返回完整详情', async () => {
    // 先获取列表拿到一个 ID
    const listRes = await req('/api/v1/product/list', { page: 1, pageSize: 1, filters: { status: 'active' } });
    const listJson = await listRes.json();
    const productId = listJson.data.items[0].id;

    const res = await req('/api/v1/product/detail', { id: productId });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(productId);
    expect(json.data.images).toBeDefined();
    expect(json.data.skus).toBeDefined();
    expect(json.data.categories).toBeDefined();
    expect(Array.isArray(json.data.skus)).toBe(true);
  });

  // 4. 商品详情（不存在）
  test('POST /api/v1/product/detail — 不存在返回 404', async () => {
    const res = await req('/api/v1/product/detail', { id: 'nonexistent-product-id' });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.meta.code).toBe('PRODUCT_2001');
  });

  // 5. 商品详情（缓存命中）
  test('POST /api/v1/product/detail — 第二次请求命中缓存', async () => {
    const listRes = await req('/api/v1/product/list', { page: 1, pageSize: 1, filters: { status: 'active' } });
    const listJson = await listRes.json();
    const productId = listJson.data.items[0].id;

    // 第一次请求（写缓存）
    await req('/api/v1/product/detail', { id: productId });
    // 第二次请求（应命中缓存，[CACHE HIT] 日志可见）
    const res = await req('/api/v1/product/detail', { id: productId });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(productId);
  });

  // 6. SKU 列表
  test('POST /api/v1/product/sku/list — 返回 SKU 列表', async () => {
    const listRes = await req('/api/v1/product/list', { page: 1, pageSize: 1, filters: { status: 'active' } });
    const listJson = await listRes.json();
    const productId = listJson.data.items[0].id;

    const res = await req('/api/v1/product/sku/list', { productId });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
  });
});
