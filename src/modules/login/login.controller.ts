import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { loginService, AuthenticationError } from './login.service.ts';
import { loginBodySchema, refreshTokenBodySchema } from './login.schema.ts';
import { ApiResult, onZodError } from '@/utils/response.ts';
import { createUserSchema } from '@/modules/users/user.schema.ts';
import { UserService } from '@/modules/users/user.service.ts';
import { parseDbError } from '@/utils/db-error.ts';

const login = new Hono();

/**
 * POST /api/account/login
 * 用户登录接口
 */
login.post('/login', zValidator('json', loginBodySchema, onZodError), async (c) => {
  try {
    const loginData = c.req.valid('json');
    const { accessToken, refreshToken, user } = await loginService.authenticate(loginData);

    return ApiResult.success(c, {
      accessToken,
      refreshToken,
      user,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return ApiResult.error(c, error.message, 401);
    }

    // 对于其他未知错误，让全局错误处理器捕获
    throw error;
  }
});

/**
 * POST /api/account/refresh
 * 刷新 Access Token
 */
login.post('/refresh', zValidator('json', refreshTokenBodySchema, onZodError), async (c) => {
  try {
    const { refreshToken } = c.req.valid('json');
    const { accessToken, refreshToken: newRefreshToken } = await loginService.refreshToken(refreshToken);

    return ApiResult.success(c, { accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return ApiResult.error(c, error.message, 401);
    }
    throw error;
  }
});

// 2. 创建用户 (带 JSON 校验)
login.post('/register', zValidator('json', createUserSchema, onZodError), async (c) => {
  try {
    const validated = c.req.valid('json');
    const data = await UserService.create(validated);
    return ApiResult.success(c, data, '注册成功');
  } catch (e: any) {
    // 架构师建议：始终在服务端打印原始错误，便于调试
    console.error('[Register Error]', e);

    // 1. 处理数据库唯一约束冲突 (现在只有 email)
    const { errorCode } = parseDbError(e);
    if (errorCode === '23505') {
      return ApiResult.error(c, '该邮箱已被注册', 409);
    }

    // 2. 对于其他所有错误，返回统一的服务端错误提示
    return ApiResult.error(c, '服务器繁忙，请稍后再试', 500);
  }
});

export const loginController = login;
