import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { loginService, AuthenticationError } from './login.service.ts';
import { loginBodySchema, refreshTokenBodySchema } from './login.schema.ts';
import { ApiResult, onZodError } from '@/utils/response.ts';
import { parseDbError } from '@/utils/db-error.ts';
import { createUserSchema } from '@/modules/users/user.schema.ts';
import { UserService } from '@/modules/users/user.service.ts';
import { rateLimit } from '@/middleware/rate-limit.ts';
import { logger } from '@/lib/logger.ts';

const loginRoute = new Hono();

/**
 * POST /api/v1/account/login
 * 限流：同一 IP 每分钟最多 10 次（bcrypt 计算密集，严格保护）
 */
loginRoute.post(
  '/login',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:login:' }),
  zValidator('json', loginBodySchema, onZodError),
  async (c) => {
    try {
      const { accessToken, refreshToken, user } = await loginService.authenticate(c.req.valid('json'));
      return ApiResult.success(c, { accessToken, refreshToken, user });
    } catch (error) {
      if (error instanceof AuthenticationError) return ApiResult.error(c, error.message, 401);
      throw error;
    }
  }
);

/**
 * POST /api/v1/account/refresh
 * 限流：同一 IP 每分钟最多 30 次（滑动续期频率相对较高，适度宽松）
 */
loginRoute.post(
  '/refresh',
  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'rl:refresh:' }),
  zValidator('json', refreshTokenBodySchema, onZodError),
  async (c) => {
    try {
      const { refreshToken } = c.req.valid('json');
      const { accessToken, refreshToken: newRefreshToken } = await loginService.refreshToken(refreshToken);
      return ApiResult.success(c, { accessToken, refreshToken: newRefreshToken });
    } catch (error) {
      if (error instanceof AuthenticationError) return ApiResult.error(c, error.message, 401);
      throw error;
    }
  }
);

/**
 * POST /api/v1/account/register
 * 限流：同一 IP 每小时最多 5 次（防止批量注册/垃圾账号）
 * 注册触发点在此，实际用户创建逻辑委托给 UserService（职责分离）
 */
loginRoute.post(
  '/register',
  rateLimit({ windowMs: 60 * 60_000, max: 5, keyPrefix: 'rl:register:' }),
  zValidator('json', createUserSchema, onZodError),
  async (c) => {
    try {
      const data = await UserService.create(c.req.valid('json'));
      return ApiResult.success(c, data, '注册成功');
    } catch (e: any) {
      logger.error('Register failed', { error: e?.message });
      const { errorCode } = parseDbError(e);
      if (errorCode === '23505') return ApiResult.error(c, '该邮箱已被注册', 409);
      return ApiResult.error(c, '服务器繁忙，请稍后再试', 500);
    }
  }
);

export { loginRoute };
