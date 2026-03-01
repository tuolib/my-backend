/**
 * 分类 API 集成测试
 * 列表、树形结构、详情
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

describe('Category API', () => {
  // 1. 分类列表
  test('POST /api/v1/category/list — 返回全部分类', async () => {
    const res = await req('/api/v1/category/list', {});
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
  });

  // 2. 分类树
  test('POST /api/v1/category/tree — 嵌套结构正确', async () => {
    const res = await req('/api/v1/category/tree', {});
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);

    // 顶级分类应有 children
    const topLevel = json.data;
    expect(topLevel.length).toBeGreaterThan(0);

    // 至少有一个顶级分类有子分类
    const withChildren = topLevel.filter((c: any) => c.children.length > 0);
    expect(withChildren.length).toBeGreaterThan(0);
  });

  // 3. 分类详情
  test('POST /api/v1/category/detail — 返回正确', async () => {
    // 先获取列表拿到 ID
    const listRes = await req('/api/v1/category/list', {});
    const listJson = await listRes.json();
    const catId = listJson.data[0].id;

    const res = await req('/api/v1/category/detail', { id: catId });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(catId);
    expect(json.data.name).toBeDefined();
  });

  // 4. 分类详情（不存在）
  test('POST /api/v1/category/detail — 不存在返回 404', async () => {
    const res = await req('/api/v1/category/detail', { id: 'nonexistent-cat-id' });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.meta.code).toBe('PRODUCT_2004');
  });
});
