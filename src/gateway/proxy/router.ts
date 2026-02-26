import { createMiddleware } from 'hono/factory';
import { ApiResult } from '@/utils/response.ts';
import { logger } from '@/lib/logger.ts';
import { gatewayConfig } from '../config.ts';
import type { DownstreamRoute } from '../types.ts';

/**
 * 运行时路由表
 *
 * 从 gatewayConfig.services 构建，附加熔断器运行时状态。
 * key = prefix（如 "/api/v1/users"），value = DownstreamRoute
 */
export const routeTable = new Map<string, DownstreamRoute>(
  gatewayConfig.services.map((svc) => [
    svc.prefix,
    {
      ...svc,
      circuitState: 'closed',
      failureCount: 0,
      lastFailureTime: 0,
    },
  ])
);

/**
 * 根据请求路径匹配下游路由（最长前缀匹配）
 */
export function resolveUpstream(path: string): DownstreamRoute | null {
  let bestMatch: DownstreamRoute | null = null;
  let bestLen = 0;

  for (const [prefix, route] of routeTable) {
    if (path.startsWith(prefix) && prefix.length > bestLen) {
      bestMatch = route;
      bestLen = prefix.length;
    }
  }

  return bestMatch;
}

/**
 * 网关代理中间件（stub — 返回 502 占位）
 *
 * 匹配到下游路由时返回 502 占位响应，未匹配时 fall-through 到本地业务路由。
 *
 * TODO: 生产实现 —
 * - fetch() 转发请求到 upstream，透传 headers
 * - AbortSignal.timeout(route.timeout) 超时控制
 * - GET 请求重试 (route.retryEnabled, route.retryMax)
 * - 熔断器状态机 (closed → open → half-open)
 * - 请求/响应 header 改写（X-Forwarded-For, X-Request-ID 等）
 */
export const gatewayProxyMiddleware = createMiddleware(async (c, next) => {
  const route = resolveUpstream(c.req.path);

  if (!route) {
    // 无匹配路由，fall-through 到本地业务路由
    await next();
    return;
  }

  // TODO: 实际代理转发逻辑
  logger.debug('Gateway proxy stub hit', {
    path: c.req.path,
    upstream: route.upstream,
    prefix: route.prefix,
  });

  return ApiResult.error(
    c,
    `代理转发未实现: ${route.prefix} → ${route.upstream}`,
    502,
    { stub: true, upstream: route.upstream }
  );
});
