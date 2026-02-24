import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { loginService, AuthenticationError } from './login.service.ts';
import { loginBodySchema, refreshTokenBodySchema } from './login.schema.ts';
import { ApiResult, onZodError } from '@/utils/response.ts';
import { parseDbError } from '@/utils/db-error.ts';
import { createUserSchema } from '@/modules/users/user.schema.ts';
import { UserService } from '@/modules/users/user.service.ts';

const loginRoute = new Hono();

// POST /api/account/login
loginRoute.post('/login', zValidator('json', loginBodySchema, onZodError), async (c) => {
  try {
    const { accessToken, refreshToken, user } = await loginService.authenticate(c.req.valid('json'));
    return ApiResult.success(c, { accessToken, refreshToken, user });
  } catch (error) {
    if (error instanceof AuthenticationError) return ApiResult.error(c, error.message, 401);
    throw error;
  }
});

// POST /api/account/refresh
loginRoute.post('/refresh', zValidator('json', refreshTokenBodySchema, onZodError), async (c) => {
  try {
    const { refreshToken } = c.req.valid('json');
    const { accessToken, refreshToken: newRefreshToken } = await loginService.refreshToken(refreshToken);
    return ApiResult.success(c, { accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    if (error instanceof AuthenticationError) return ApiResult.error(c, error.message, 401);
    throw error;
  }
});

// POST /api/account/register
// 注册属于 auth 流程的触发点，用户创建逻辑委托给 UserService
loginRoute.post('/register', zValidator('json', createUserSchema, onZodError), async (c) => {
  try {
    const data = await UserService.create(c.req.valid('json'));
    return ApiResult.success(c, data, '注册成功');
  } catch (e: any) {
    console.error('[Register Error]', e);
    const { errorCode } = parseDbError(e);
    if (errorCode === '23505') return ApiResult.error(c, '该邮箱已被注册', 409);
    return ApiResult.error(c, '服务器繁忙，请稍后再试', 500);
  }
});

export { loginRoute };
