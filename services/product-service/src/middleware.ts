/**
 * Product Service 中间件实例
 * 抽离到独立文件避免循环引用（routes → index → routes）
 */
import { createAuthMiddleware, createAdminAuthMiddleware } from '@repo/shared';
import { redis } from '@repo/database';

export const authMiddleware = createAuthMiddleware(redis);
export const adminAuthMiddleware = createAdminAuthMiddleware();
