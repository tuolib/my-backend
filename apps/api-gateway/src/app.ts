/**
 * API Gateway — Hono App 组装
 * 中间件链严格按顺序：request-id → logger → cors → block-internal → rate-limit → auth-gate → idempotent-gate → error-handler
 * 通配符路由转发所有 /api/v1/* 请求到对应下游服务
 */
import { Hono } from 'hono';
import {
  requestId,
  logger,
  errorHandler,
  NotFoundError,
} from '@repo/shared';
import type { AppEnv } from '@repo/shared';
import { createCorsMiddleware } from './middleware/cors';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { authGate } from './middleware/auth-gate';
import { idempotentGate } from './middleware/idempotent-gate';
import { blockInternal } from './middleware/block-internal';
import { findTarget } from './routes/registry';
import { healthCheck } from './routes/health';
import { forwardRequest } from './proxy/forward';

const app = new Hono<AppEnv>();

// ── 中间件链（严格按顺序）──
app.use('*', requestId());          // 1. traceId 注入
app.use('*', logger());             // 2. 请求日志
app.use('*', createCorsMiddleware()); // 3. CORS
app.use('*', blockInternal());      // 4. 拦截 /internal/*
app.use('*', rateLimitMiddleware()); // 5. 限流
app.use('*', authGate());           // 6. 鉴权（公开路由跳过）
app.use('*', idempotentGate());     // 7. 幂等（仅特定路由）
app.onError(errorHandler);          // 8. 全局错误处理

// ── 健康检查 ──
app.get('/health', healthCheck);
app.post('/health', healthCheck);

// ── 路由转发（捕获所有 /api/v1/* 请求）──
app.all('/api/v1/*', async (c) => {
  const target = findTarget(c.req.path);
  if (!target) {
    throw new NotFoundError('Route not found');
  }
  return forwardRequest(c, target);
});

// ── 404 ──
app.all('*', () => {
  throw new NotFoundError('Not Found');
});

export { app };
