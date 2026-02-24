import { Hono } from 'hono';
import { authMiddleware } from '@/middleware/auth.ts';
import { requestIdMiddleware } from '@/middleware/request-id.ts';
import { loginRoute } from '@/modules/login/login.route.ts';
import userRoute from '@/modules/users/user.route.ts';

/**
 * 构建完整路由树。
 *
 * 结构：
 *   /api/v1/account/*  — 公开路由（登录、注册、刷新 Token）
 *   /api/v1/users/*    — 受保护路由（需要 JWT + Redis session 认证）
 *
 * 版本化原则：
 *   /v1 前缀允许未来平滑引入 /v2 路由，新旧版本共存，客户端按需迁移。
 */
export const buildRouter = (): Hono => {
  const router = new Hono();

  // Request ID 应用于所有路由，确保每条日志都可追踪
  router.use('*', requestIdMiddleware);

  // 公开路由（无需认证）
  const publicApi = new Hono();
  publicApi.route('/account', loginRoute);

  // 受保护路由（JWT + Redis session 验证）
  const protectedApi = new Hono();
  protectedApi.use('*', authMiddleware);
  protectedApi.route('/users', userRoute);

  // 统一挂载到 /api/v1
  router.route('/api/v1', publicApi);
  router.route('/api/v1', protectedApi);

  return router;
};
