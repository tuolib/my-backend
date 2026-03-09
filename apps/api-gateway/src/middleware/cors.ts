/**
 * CORS 中间件 — 跨域策略
 * 开发环境允许 localhost，生产环境从 CORS_ORIGINS 环境变量读取白名单
 */
import { cors } from 'hono/cors';
import { getConfig } from '@repo/shared';

export function createCorsMiddleware() {
  const config = getConfig();
  const allowAll = config.cors.origins.includes('*');
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    ...config.cors.origins,
  ];

  return cors({
    origin: (origin) => {
      if (!origin) return '';
      // CORS_ORIGINS 包含 * 时允许所有域名（回显 origin，兼容 credentials: true）
      if (allowAll) return origin;
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
