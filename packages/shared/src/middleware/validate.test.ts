/**
 * validate 中间件测试
 */
import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types/context';
import { requestId } from './request-id';
import { errorHandler } from './error-handler';
import { validate } from './validate';

const testSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

function createApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.onError(errorHandler);
  app.post('/test', validate(testSchema), (c) => {
    return c.json({ validated: c.get('validated') });
  });
  return app;
}

describe('validate middleware', () => {
  test('合法 body 通过校验，c.get("validated") 有值', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', name: 'Kim' }),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.validated.email).toBe('test@example.com');
    expect(body.validated.name).toBe('Kim');
  });

  test('非法 body 抛出 422 + details', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-email', name: '' }),
    });

    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe(422);
    expect(body.meta.details).toBeTruthy();
  });

  test('缺少字段 → 422', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(422);
  });
});
