/**
 * CORS 中间件 — 跨域策略
 * 开发环境允许 localhost，生产环境从 CORS_ORIGINS 环境变量读取白名单
 */
import { cors } from 'hono/cors';
import { getConfig } from '@repo/shared';

export function createCorsMiddleware() {
  const config = getConfig();
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    ...config.cors.origins,
  ];

  return cors({
    origin: (origin) => {
      if (!origin) return '';
      return allowedOrigins.includes(origin) ? origin : '';
    },
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Idempotency-Key',
      'X-Request-Id',
    ],
    exposeHeaders: ['X-Request-Id', 'X-Trace-Id'],
    maxAge: 86400,
    credentials: true,
  });
}
