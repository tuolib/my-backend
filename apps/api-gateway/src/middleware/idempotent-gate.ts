/**
 * 幂等网关中间件 — 仅对特定路由生效
 * 订单创建、支付发起需要 X-Idempotency-Key 防止重复提交
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '@repo/shared';
import { createIdempotentMiddleware } from '@repo/shared';
import { redis } from '@repo/database';

const idempotentMiddleware = createIdempotentMiddleware(redis);

/** 需要幂等检查的路由 */
const IDEMPOTENT_ROUTES = [
  '/api/v1/order/create',
  '/api/v1/payment/create',
];

export function idempotentGate(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (IDEMPOTENT_ROUTES.includes(c.req.path)) {
      return idempotentMiddleware(c, next);
    }
    return next();
  };
}
