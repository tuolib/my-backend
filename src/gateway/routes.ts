import { Hono } from 'hono';
import { ApiResult } from '@/utils/response.ts';
import { checkRedisReadiness } from '@/lib/redis.ts';
import { gatewayConfig } from './config.ts';

/**
 * 网关系统路由
 *
 * /health — 存活探测，始终返回 200
 * /ready  — 就绪探测，检查 Redis 连通性，失败返回 503
 */
export const gatewayRoutes = new Hono();

const { healthCheck } = gatewayConfig;

gatewayRoutes.get(healthCheck.livenessPath, (c) => {
  return ApiResult.success(c, { status: 'ok' }, '网关存活');
});

gatewayRoutes.get(healthCheck.readinessPath, async (c) => {
  try {
    await checkRedisReadiness();
    return ApiResult.success(c, { status: 'ready' }, '网关就绪');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    return ApiResult.error(c, `网关未就绪: ${reason}`, 503, { status: 'not-ready' });
  }
});
