import { Hono } from 'hono';
import { authMiddleware } from '@/middleware/auth.ts';
import { loginRoute } from '@/modules/login/login.route.ts';
import userRoute from '@/modules/users/user.route.ts';

export const buildRouter = (): Hono => {
  const router = new Hono();

  // 公开路由组（无需认证）
  const publicApi = new Hono();
  publicApi.route('/account', loginRoute);

  // 受保护路由组（需要 JWT + Redis session 验证）
  const protectedApi = new Hono();
  protectedApi.use('*', authMiddleware);
  protectedApi.route('/users', userRoute);

  // 统一挂载到 /api 前缀
  router.route('/api', publicApi);
  router.route('/api', protectedApi);

  return router;
};
