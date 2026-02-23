import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';
import { redisIns } from '@/lib/redis';
import { ApiResult } from '@/utils/response';
import { JWT_SECRET, REDIS_SESSION_PREFIX } from '@/middleware/auth-config';

/**
 * 认证中间件
 * 负责：
 * 1. 验证 JWT 令牌的有效性（签名、过期时间）
 * 2. 检查 Redis 中的会话状态（实现单点登录/强制下线）
 * 3. 将用户信息注入到请求上下文中
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  console.log(`[Auth Middleware] Checking request for: ${c.req.path}`); // 添加日志

  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    console.log('[Auth Middleware] Failed: No Authorization header');
    return ApiResult.error(c, '未提供认证令牌', 401);
  }

  // 提取 Token: "Bearer <token>"
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  if (!token) {
    return ApiResult.error(c, '令牌格式错误', 401);
  }

  try {
    // 1. 验证 JWT 签名和过期时间
    // verify 函数会抛出异常如果 token 无效
    const payload = await verify(token, JWT_SECRET, 'HS256');

    // 2. 架构师思维：多因素校验（异地登录踢出逻辑）
    // 从 Redis 获取当前有效的 Session ID
    // 注意：payload.sub 存储的是 userId
    const userId = payload.sub as string;
    const currentSid = await redisIns.get(`${REDIS_SESSION_PREFIX}${userId}`);

    // 如果 Redis 中没有记录（会话过期）或者 sid 不匹配（被顶号），则拒绝访问
    if (!currentSid || payload.sid !== currentSid) {
      return ApiResult.error(c, '会话已失效或在其他设备登录', 401);
    }

    // 3. 将用户信息注入 Context
    // 这样后续的 Controller 可以直接通过 c.get('jwtPayload') 获取用户信息
    c.set('jwtPayload', payload);

    await next();
  } catch (error) {
    // 区分不同类型的错误可以提供更友好的提示，这里简化处理
    return ApiResult.error(c, '令牌无效或已过期', 401);
  }
});
