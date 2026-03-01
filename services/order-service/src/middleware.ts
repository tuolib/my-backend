/**
 * Order Service 中间件实例
 */
import { createAuthMiddleware, createIdempotentMiddleware } from '@repo/shared';
import { redis } from '@repo/database';

export const authMiddleware = createAuthMiddleware(redis);
export const idempotentMiddleware = createIdempotentMiddleware(redis);
