import { createMiddleware } from 'hono/factory';
import { gatewayConfig } from '../config.ts';
import type { DownstreamRoute } from '../types.ts';
import { handleGatewayRequest } from '../executor.ts';

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
 * 网关代理中间件
 *
 * 调用 handleGatewayRequest 编排完整执行流（认证→熔断→调度→响应映射）。
 * 返回 Response 则网关已处理；返回 null 则 fall-through 到本地业务路由。
 */
export const gatewayProxyMiddleware = createMiddleware(async (c, next) => {
  const result = await handleGatewayRequest(c);
  if (result) return result;
  await next();
});
