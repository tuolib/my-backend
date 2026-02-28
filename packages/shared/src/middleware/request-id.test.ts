/**
 * request-id 中间件测试
 */
import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import type { AppEnv } from '../types/context';
import { requestId } from './request-id';

function createApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.get('/test', (c) => c.json({ traceId: c.get('traceId') }));
  return app;
}

describe('requestId middleware', () => {
  test('没有传 X-Request-Id 时自动生成 21 位 ID', async () => {
    const app = createApp();
    const res = await app.request('/test');
    const body = await res.json();

    expect(body.traceId).toBeTruthy();
    expect(body.traceId).toHaveLength(21);

    const header = res.headers.get('X-Request-Id');
    expect(header).toBe(body.traceId);
  });

  test('传了 X-Request-Id 时使用传入的值', async () => {
    const app = createApp();
    const customId = 'my-custom-trace-id-123';
    const res = await app.request('/test', {
      headers: { 'X-Request-Id': customId },
    });
    const body = await res.json();

    expect(body.traceId).toBe(customId);
    expect(res.headers.get('X-Request-Id')).toBe(customId);
  });

  test('响应 header 包含 X-Request-Id', async () => {
    const app = createApp();
    const res = await app.request('/test');

    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });
});
