import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';
import { redisIns } from '@/lib/redis.ts';
import { ApiResult } from '@/utils/response.ts';
import { logger } from '@/lib/logger.ts';
import { JWT_SECRET, REDIS_SESSION_PREFIX } from '@/middleware/auth-config.ts';

/**
 * Redis 熔断器状态。
 *
 * 设计原则：安全性 vs 可用性的平衡
 * - Redis 正常：完整验证 JWT 签名 + Redis session（防 token 泄露/强制下线）
 * - Redis 故障（熔断打开）：降级为仅 JWT 签名验证，保证服务不中断
 * - 降级期间 token 仍受 JWT 过期时间保护（最多 15 分钟窗口期）
 * - 5 秒后自动尝试半开，快速恢复完整验证
 */
let circuitOpen = false;
let lastFailureTime = 0;
const CIRCUIT_TIMEOUT_MS = 5_000;

async function verifySession(userId: string, sid: string): Promise<boolean> {
  // 熔断打开期间：跳过 Redis 检查，降级为 JWT-only 认证
  if (circuitOpen) {
    if (Date.now() - lastFailureTime < CIRCUIT_TIMEOUT_MS) {
      logger.warn('Redis circuit open, JWT-only auth degraded', { userId });
      return true;
    }
    circuitOpen = false; // 半开：尝试恢复
  }

  try {
    const currentSid = await redisIns.get(`${REDIS_SESSION_PREFIX}${userId}`);
    return !!(currentSid && sid === currentSid);
  } catch (err) {
    circuitOpen = true;
    lastFailureTime = Date.now();
    logger.error('Redis session check failed, opening circuit', { error: String(err) });
    return true; // 降级放行，避免全站 401
  }
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return ApiResult.error(c, '未提供认证令牌', 401);
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  if (!token) {
    return ApiResult.error(c, '令牌格式错误', 401);
  }

  try {
    const payload = await verify(token, JWT_SECRET, 'HS256');
    const userId = payload.sub as string;
    const sid = payload.sid as string;

    const isValid = await verifySession(userId, sid);
    if (!isValid) {
      return ApiResult.error(c, '会话已失效或在其他设备登录', 401);
    }

    c.set('jwtPayload', payload);
    await next();
  } catch {
    return ApiResult.error(c, '令牌无效或已过期', 401);
  }
});
