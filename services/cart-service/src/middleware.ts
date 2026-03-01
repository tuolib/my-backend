/**
 * Cart Service 中间件实例
 * 抽离到独立文件避免循环引用
 */
import { createAuthMiddleware } from '@repo/shared';
import { redis } from '@repo/database';

export const authMiddleware = createAuthMiddleware(redis);
