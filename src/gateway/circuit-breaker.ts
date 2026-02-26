import { logger } from '@/lib/logger.ts';
import { gatewayConfig } from './config.ts';
import type { DownstreamRoute } from './types.ts';

/**
 * 检查熔断器状态，决定是否允许请求通过。
 *
 * 状态机：closed（正常）→ open（熔断）→ half-open（探测）→ closed
 * - closed:    放行，正常转发
 * - open:      超过 resetTimeout 则转 half-open，否则拒绝
 * - half-open: 放行一个探测请求，由 recordSuccess/recordFailure 决定后续状态
 */
export function checkCircuitBreaker(route: DownstreamRoute): 'closed' | 'open' | 'half-open' {
  if (!gatewayConfig.circuitBreaker.enabled) {
    return 'closed';
  }

  if (route.circuitState === 'closed') {
    return 'closed';
  }

  if (route.circuitState === 'open') {
    const elapsed = Date.now() - route.lastFailureTime;
    if (elapsed >= gatewayConfig.circuitBreaker.resetTimeout) {
      route.circuitState = 'half-open';
      logger.info('Circuit breaker half-open, allowing probe request', {
        prefix: route.prefix,
        elapsed,
      });
      return 'half-open';
    }
    return 'open';
  }

  // half-open: 允许探测请求通过
  return 'half-open';
}

/**
 * 记录下游调用成功 — 重置熔断器到 closed 状态。
 *
 * 仅在状态发生变化时记录日志，避免高频请求日志刷屏。
 */
export function recordSuccess(route: DownstreamRoute): void {
  const wasOpen = route.circuitState !== 'closed';
  route.failureCount = 0;
  route.circuitState = 'closed';

  if (wasOpen) {
    logger.info('Circuit breaker reset to closed', { prefix: route.prefix });
  }
}

/**
 * 记录下游调用失败 — 累计失败次数，达到阈值则打开熔断器。
 *
 * 直接修改 route 对象属性（routeTable Map 中的引用），
 * 状态在进程生命周期内有效。
 */
export function recordFailure(route: DownstreamRoute): void {
  route.failureCount++;

  if (
    gatewayConfig.circuitBreaker.enabled &&
    route.failureCount >= gatewayConfig.circuitBreaker.failureThreshold
  ) {
    route.circuitState = 'open';
    route.lastFailureTime = Date.now();
    logger.warn('Circuit breaker opened', {
      prefix: route.prefix,
      failureCount: route.failureCount,
      threshold: gatewayConfig.circuitBreaker.failureThreshold,
    });
  } else {
    logger.warn('Downstream failure recorded', {
      prefix: route.prefix,
      failureCount: route.failureCount,
    });
  }
}
