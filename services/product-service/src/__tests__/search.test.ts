/**
 * 搜索 API 集成测试
 * 全文搜索 + 筛选 + 空结果
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

describe('Search API', () => {
  // 1. 搜索 iPhone
  test('POST /api/v1/product/search — 搜索 iPhone', async () => {
    const res = await req('/api/v1/product/search', { keyword: 'iPhone' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items.length).toBeGreaterThan(0);
    const titles = json.data.items.map((i: any) => i.title.toLowerCase());
    expect(titles.some((t: string) => t.includes('iphone'))).toBe(true);
  });

  // 2. 搜索不存在的商品
  test('POST /api/v1/product/search — 搜索不存在的商品返回空', async () => {
    const res = await req('/api/v1/product/search', { keyword: '完全不存在的商品xyz123' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items.length).toBe(0);
  });

  // 3. 搜索 + 价格区间筛选
  test('POST /api/v1/product/search — 价格区间筛选', async () => {
    const res = await req('/api/v1/product/search', {
      keyword: 'Apple',
      priceMin: 5000,
      priceMax: 10000,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // 如果有结果，验证价格在区间内
    for (const item of json.data.items) {
      if (item.maxPrice) {
        expect(parseFloat(item.maxPrice)).toBeLessThanOrEqual(10000);
      }
    }
  });

  // 4. 搜索关键字校验
  test('POST /api/v1/product/search — 空关键字返回 422', async () => {
    const res = await req('/api/v1/product/search', { keyword: '' });
    expect(res.status).toBe(422);
  });
});
