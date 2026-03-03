/**
 * 健康检查路由 — 聚合所有下游服务 + 基础设施状态
 * GET|POST /health
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

/** 轻量存活检查：仅确认进程可响应，不依赖外部组件 */
export function liveCheck(c: Context<AppEnv>) {
  return c.json({ status: 'ok', service: 'api-gateway' }, 200);
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

  // 核心基础设施：gateway + postgres + redis 决定 HTTP 状态码
  const coreOk =
    checks.gateway === 'ok' &&
    checks.postgres === 'ok' &&
    checks.redis === 'ok';

  // 下游服务状态仅作为信息展示，不影响 HTTP 状态码
  // Swarm 并行启动时下游服务可能暂时不可用，不应导致 503
  const allOk = Object.values(checks).every((v) => v === 'ok');
  const status = coreOk ? 200 : 503;
  const label = allOk ? 'healthy' : coreOk ? 'degraded' : 'unhealthy';

  return c.json({ status: label, checks }, status);
}
