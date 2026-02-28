/**
 * 健康检查路由 — 聚合所有下游服务 + 基础设施状态
 * POST /health
 * 每个下游服务设 3 秒超时，单个服务故障不影响整体响应
 */
import type { Context } from 'hono';
import type { AppEnv } from '@repo/shared';
import { connection, redis } from '@repo/database';
import { getConfig } from '@repo/shared';

interface HealthChecks {
  gateway: string;
  postgres: string;
  redis: string;
  userService: string;
  productService: string;
  cartService: string;
  orderService: string;
}

/** 检查单个下游服务健康状态 */
async function checkService(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}

export async function healthCheck(c: Context<AppEnv>) {
  const config = getConfig();
  const { userUrl, productUrl, cartUrl, orderUrl } = config.services;

  const checks: HealthChecks = {
    gateway: 'ok',
    postgres: 'unknown',
    redis: 'unknown',
    userService: 'unknown',
    productService: 'unknown',
    cartService: 'unknown',
    orderService: 'unknown',
  };

  // 并行检查所有依赖
  const [pgResult, redisResult, userResult, productResult, cartResult, orderResult] =
    await Promise.allSettled([
      connection`SELECT 1`.then(() => 'ok' as const).catch(() => 'down' as const),
      redis.ping().then(() => 'ok' as const).catch(() => 'down' as const),
      checkService(`${userUrl}/health`),
      checkService(`${productUrl}/health`),
      checkService(`${cartUrl}/health`),
      checkService(`${orderUrl}/health`),
    ]);

  checks.postgres = pgResult.status === 'fulfilled' ? pgResult.value : 'down';
  checks.redis = redisResult.status === 'fulfilled' ? redisResult.value : 'down';
  checks.userService = userResult.status === 'fulfilled' ? userResult.value : 'down';
  checks.productService = productResult.status === 'fulfilled' ? productResult.value : 'down';
  checks.cartService = cartResult.status === 'fulfilled' ? cartResult.value : 'down';
  checks.orderService = orderResult.status === 'fulfilled' ? orderResult.value : 'down';

  const allOk = Object.values(checks).every((v) => v === 'ok');
  const status = allOk ? 200 : 503;

  return c.json({ status: allOk ? 'healthy' : 'degraded', checks }, status);
}
