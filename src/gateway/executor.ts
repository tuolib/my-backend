import type { Context } from 'hono';
import { ApiResult } from '@/utils/response.ts';
import { logger } from '@/lib/logger.ts';
import { gatewayConfig } from './config.ts';
import { authenticateRequest } from './auth.ts';
import { resolveUpstream } from './proxy/router.ts';
import { dispatchToService } from './proxy/dispatch.ts';
import { checkCircuitBreaker, recordSuccess, recordFailure } from './circuit-breaker.ts';

/**
 * 网关核心执行编排器
 *
 * 顺序执行：路由查找 → 认证检查 → 熔断判断 → 下游调度 → 响应映射。
 *
 * 返回值约定：
 * - Response  — 网关已处理（匹配到下游路由，无论成功或失败）
 * - null      — 无匹配路由，调用方应 fall-through 到本地业务路由
 *
 * 注意：限流由 gatewayRateLimitMiddleware 在 Hono use('*') 层处理，
 * 先于本函数执行，因此这里不重复限流逻辑。
 */
export async function handleGatewayRequest(c: Context): Promise<Response | null> {
  const path = c.req.path;
  const method = c.req.method;

  // ── 1. 路由查找 ──
  const route = resolveUpstream(path);
  if (!route) {
    return null; // 无匹配，fall-through
  }

  logger.info('Gateway request matched', {
    prefix: route.prefix,
    upstream: route.upstream,
    method,
    path,
  });

  // ── 2. 认证检查（仅当路由要求认证且网关认证已启用）──
  if (route.authRequired && gatewayConfig.auth.enabled) {
    const identity = await authenticateRequest(c);
    if (!identity) {
      logger.warn('Gateway auth rejected', { path, method });
      return ApiResult.error(c, '未提供有效认证', 401);
    }
    c.set('gatewayUserId', identity.userId);
    c.set('gatewaySessionId', identity.sid);
  }

  // ── 3. 熔断判断 ──
  const circuitState = checkCircuitBreaker(route);
  if (circuitState === 'open') {
    logger.warn('Gateway circuit breaker open, rejecting', {
      prefix: route.prefix,
      failureCount: route.failureCount,
    });
    return ApiResult.error(c, '服务暂时不可用（熔断保护）', 502, {
      service: route.prefix,
      circuitState: 'open',
    });
  }

  // ── 4. 下游调度 ──
  try {
    const result = await dispatchToService(route, c);

    logger.info('Gateway dispatch completed', {
      prefix: route.prefix,
      ok: result.ok,
      status: result.status,
      latency: result.latency,
    });

    // ── 5. 响应映射 ──
    if (result.ok) {
      recordSuccess(route);
      return ApiResult.success(c, result.data, '网关转发成功');
    }

    if (result.timeout) {
      recordFailure(route);
      return ApiResult.error(c, '下游服务响应超时', 504, {
        service: route.prefix,
        upstream: route.upstream,
        latency: result.latency,
      });
    }

    // 下游返回错误
    recordFailure(route);
    return ApiResult.error(c, '下游服务异常', 502, {
      service: route.prefix,
      upstream: route.upstream,
      status: result.status,
      error: result.error,
    });
  } catch (err) {
    // 调度过程本身异常（网关内部错误）
    recordFailure(route);
    logger.error('Gateway dispatch exception', {
      prefix: route.prefix,
      error: err instanceof Error ? err.message : String(err),
    });
    return ApiResult.error(c, '网关内部错误', 500, {
      service: route.prefix,
    });
  }
}
