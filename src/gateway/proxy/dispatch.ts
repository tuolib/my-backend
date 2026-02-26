import type { Context } from 'hono';
import { logger } from '@/lib/logger.ts';
import type { DownstreamRoute, DispatchResult } from '../types.ts';

/**
 * 下游服务调度器（模拟实现）
 *
 * 当前返回模拟成功响应，不发起真实 HTTP 请求。
 * 记录调度日志以便调试。
 *
 * TODO: Stage2-Step4 — 替换为真实 fetch() 转发：
 * 1. 构建下游请求 URL: `${route.upstream}${c.req.path}` (或去除 prefix 后拼接)
 * 2. 创建 Request: new Request(url, {
 *      method: c.req.method,
 *      headers: forwardHeaders(c),  // 透传 X-Request-ID, X-Forwarded-For, Authorization
 *      body: ['GET','HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
 *      signal: AbortSignal.timeout(route.timeout),
 *    })
 * 3. 重试逻辑: if (route.retryEnabled && c.req.method === 'GET' && attempt < route.retryMax)
 * 4. 响应映射: 将下游 Response body 解析为 DispatchResult
 * 5. HTTP 客户端注入点: 可替换 globalThis.fetch 为自定义 wrapper 以支持 tracing/metrics
 */
export async function dispatchToService(
  route: DownstreamRoute,
  c: Context
): Promise<DispatchResult> {
  const start = performance.now();

  logger.info('Dispatching to downstream (mock)', {
    prefix: route.prefix,
    upstream: route.upstream,
    method: c.req.method,
    path: c.req.path,
  });

  // TODO: Stage2-Step4 — 用真实 fetch 替换此模拟逻辑
  const latency = Math.round(performance.now() - start);

  return {
    ok: true,
    status: 200,
    data: {
      service: route.prefix,
      upstream: route.upstream,
      method: c.req.method,
      path: c.req.path,
      message: '模拟转发成功',
    },
    timeout: false,
    latency,
  };
}
