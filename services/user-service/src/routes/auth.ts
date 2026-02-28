/**
 * 认证路由 — /api/v1/auth/*
 * 公开路由：register, login, refresh
 * 需认证路由：logout
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import { registerSchema, loginSchema, refreshSchema } from '../schemas/auth.schema';
import * as authService from '../services/auth.service';
import { authMiddleware } from '../middleware';
import type { RegisterInput, LoginInput } from '../types';

const auth = new Hono<AppEnv>();

// POST /api/v1/auth/register — 公开
auth.post('/register', validate(registerSchema), async (c) => {
  const input = c.get('validated') as RegisterInput;
  const result = await authService.register(input);
  return c.json(success(result));
});

// POST /api/v1/auth/login — 公开
auth.post('/login', validate(loginSchema), async (c) => {
  const input = c.get('validated') as LoginInput;
  const result = await authService.login(input);
  return c.json(success(result));
});

// POST /api/v1/auth/refresh — 公开
auth.post('/refresh', validate(refreshSchema), async (c) => {
  const { refreshToken } = c.get('validated') as { refreshToken: string };
  const result = await authService.refresh(refreshToken);
  return c.json(success(result));
});

// POST /api/v1/auth/logout — 需要认证
auth.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const tokenJti = c.get('tokenJti');
  const body = await c.req.json().catch(() => ({}));
  await authService.logout(userId, tokenJti, body.refreshToken);
  return c.json(success(null, '登出成功'));
});

export default auth;
