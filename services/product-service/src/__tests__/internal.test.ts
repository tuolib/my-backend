/**
 * 内部路由集成测试
 * /internal/product/sku/batch 批量查询
 */
import { describe, test, expect } from 'bun:test';
import { app } from '../index';
import { db, skus } from '@repo/database';
import { eq } from 'drizzle-orm';

const BASE = 'http://localhost';

function req(path: string, body?: unknown) {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('Internal API', () => {
  // 1. 批量查询 SKU
  test('POST /internal/product/sku/batch — 返回 SKU + 商品信息 + 首图', async () => {
    // 从 DB 获取几个 SKU ID
    const skuRows = await db.select().from(skus).limit(3);
    const skuIds = skuRows.map((s) => s.id);

    const res = await req('/internal/product/sku/batch', { skuIds });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(skuIds.length);

    // 验证数据结构
    const item = json.data[0];
    expect(item.id).toBeDefined();
    expect(item.skuCode).toBeDefined();
    expect(item.price).toBeDefined();
    expect(item.productId).toBeDefined();
    expect(item.productTitle).toBeDefined();
  });

  // 2. 部分 skuId 不存在
  test('POST /internal/product/sku/batch — 部分不存在只返回存在的', async () => {
    const skuRows = await db.select().from(skus).limit(1);
    const skuIds = [skuRows[0].id, 'nonexistent-sku-id-123'];

    const res = await req('/internal/product/sku/batch', { skuIds });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(1);
  });

  // 3. 空数组
  test('POST /internal/product/sku/batch — 空数组返回空', async () => {
    const res = await req('/internal/product/sku/batch', { skuIds: [] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(0);
  });
});
