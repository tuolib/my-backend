/**
 * 用户资料路由 — /api/v1/user/*
 * 全部需要认证
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import { updateUserSchema } from '../schemas/user.schema';
import * as userService from '../services/user.service';
import { authMiddleware } from '../middleware';
import type { UpdateUserInput } from '../types';

const user = new Hono<AppEnv>();

user.use('/*', authMiddleware);

// POST /api/v1/user/profile — 获取当前用户信息
user.post('/profile', async (c) => {
  const userId = c.get('userId');
  const profile = await userService.getProfile(userId);
  return c.json(success(profile));
});

// POST /api/v1/user/update — 更新用户资料
user.post('/update', validate(updateUserSchema), async (c) => {
  const userId = c.get('userId');
  const input = c.get('validated') as UpdateUserInput;
  const profile = await userService.updateProfile(userId, input);
  return c.json(success(profile));
});

export default user;
