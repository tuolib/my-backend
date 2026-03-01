/**
 * 健康检查测试 — 聚合下游服务和基础设施状态
 */
import { describe, test, expect } from 'bun:test';
import { app } from '../app';

/** 发送 POST 请求 */
async function post(path: string): Promise<Response> {
  return app.request(path, { method: 'POST' });
}

describe('Health Check', () => {
  test('POST /health → 返回检查结果', async () => {
    const res = await post('/health');
    const json = await res.json();

    // 应该包含所有检查项
    expect(json.checks).toBeDefined();
    expect(json.checks.gateway).toBe('ok');
    expect(json.checks.postgres).toBeDefined();
    expect(json.checks.redis).toBeDefined();
    expect(json.checks.userService).toBeDefined();
    expect(json.checks.productService).toBeDefined();
    expect(json.checks.cartService).toBeDefined();
    expect(json.checks.orderService).toBeDefined();

    // status 应该是 healthy 或 degraded
    expect(['healthy', 'degraded']).toContain(json.status);
  });

  test('PG 和 Redis 检查正常', async () => {
    const res = await post('/health');
    const json = await res.json();

    // 基础设施应该正常（PG + Redis 在 Docker 中运行）
    expect(json.checks.postgres).toBe('ok');
    expect(json.checks.redis).toBe('ok');
  });

  test('所有服务运行时返回 healthy', async () => {
    const res = await post('/health');
    const json = await res.json();

    if (json.status === 'healthy') {
      expect(res.status).toBe(200);
      expect(Object.values(json.checks).every((v) => v === 'ok')).toBe(true);
    } else {
      // 部分服务可能未运行，返回 503
      expect(res.status).toBe(503);
      expect(json.status).toBe('degraded');
    }
  });
});
