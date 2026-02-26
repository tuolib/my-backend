import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { redisIns } from '@/lib/redis.ts';
import { ApiResult } from '@/utils/response.ts';
import { logger } from '@/lib/logger.ts';
import { JWT_SECRET } from '@/middleware/auth-config.ts';
import { gatewayConfig } from './config.ts';

/**
 * JWT 黑名单检查（stub）
 *
 * TODO: 生产实现 — 查询 Redis SET `jwt:blacklist:<jti>`，
 * 用于注销 / 密码重置后立即失效已颁发的 token。
 */
export async function checkJwtBlacklist(jti: string): Promise<boolean> {
  // stub: 始终返回 false（未拉黑）
  return false;
}

/**
 * 解析并验证请求中的认证信息（stub）
 *
 * TODO: 生产实现 —
 * 1. 从 Authorization header 提取 Bearer token
 * 2. verify(token, JWT_SECRET, 'HS256') 验证签名
 * 3. checkJwtBlacklist(payload.jti) 检查黑名单
 * 4. 返回 { userId, sid } 或 null
 */
export async function authenticateRequest(
  c: Context
): Promise<{ userId: string; sid: string } | null> {
  // stub: 返回 null（未认证），网关层暂不拦截
  return null;
}

/**
 * 网关认证中间件（stub — pass-through）
 *
 * 当 gatewayConfig.auth.enabled = false（默认），直接放行。
 * 启用后将调用 authenticateRequest 验证 JWT，
 * 失败返回 401 ApiResult.error()。
 */
export const gatewayAuthMiddleware = createMiddleware(async (c, next) => {
  if (!gatewayConfig.auth.enabled) {
    await next();
    return;
  }

  // TODO: 启用后的完整认证逻辑
  const identity = await authenticateRequest(c);
  if (!identity) {
    return ApiResult.error(c, '未提供有效认证', 401);
  }

  c.set('gatewayUserId', identity.userId);
  c.set('gatewaySessionId', identity.sid);
  await next();
});
