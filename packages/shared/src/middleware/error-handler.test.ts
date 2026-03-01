/**
 * error-handler 中间件测试
 * 验证 AppError 子类 → 标准错误响应格式
 */
import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import type { AppEnv } from '../types/context';
import { requestId } from './request-id';
import { errorHandler } from './error-handler';
import {
  NotFoundError,
  ValidationError,
  InternalError,
  UnauthorizedError,
} from '../errors/http-errors';
import { ErrorCode } from '../errors/error-codes';

function createApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.onError(errorHandler);
  return app;
}

describe('errorHandler', () => {
  test('NotFoundError → 404 标准响应', async () => {
    const app = createApp();
    app.get('/test', () => {
      throw new NotFoundError('用户不存在', ErrorCode.USER_NOT_FOUND);
    });

    const res = await app.request('/test');
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.code).toBe(404);
    expect(body.success).toBe(false);
    expect(body.message).toBe('用户不存在');
    expect(body.data).toBeNull();
    expect(body.meta.code).toBe(ErrorCode.USER_NOT_FOUND);
    expect(body.meta.message).toBe('用户不存在');
    expect(body.traceId).toBeTruthy();
  });

  test('ValidationError → 422 + details 包含字段信息', async () => {
    const app = createApp();
    const details = { fieldErrors: { email: ['必填'] } };
    app.get('/test', () => {
      throw new ValidationError('数据校验失败', undefined, details);
    });

    const res = await app.request('/test');
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.code).toBe(422);
    expect(body.success).toBe(false);
    expect(body.meta.details).toEqual(details);
  });

  test('UnauthorizedError → 401', async () => {
    const app = createApp();
    app.get('/test', () => {
      throw new UnauthorizedError('未授权', ErrorCode.TOKEN_EXPIRED);
    });

    const res = await app.request('/test');
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.code).toBe(401);
    expect(body.meta.code).toBe(ErrorCode.TOKEN_EXPIRED);
  });

  test('普通 Error → 500', async () => {
    const app = createApp();
    app.get('/test', () => {
      throw new Error('unexpected crash');
    });

    const res = await app.request('/test');
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.code).toBe(500);
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.meta.code).toBe('INTERNAL_ERROR');
    expect(body.traceId).toBeTruthy();
  });

  test('响应结构包含所有必需字段', async () => {
    const app = createApp();
    app.get('/test', () => {
      throw new InternalError('系统错误');
    });

    const res = await app.request('/test');
    const body = await res.json();

    expect(body).toHaveProperty('code');
    expect(body).toHaveProperty('success');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('meta');
    expect(body).toHaveProperty('traceId');
    expect(body.meta).toHaveProperty('code');
    expect(body.meta).toHaveProperty('message');
  });
});
