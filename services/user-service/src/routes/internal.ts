/**
 * 内部路由 — /internal/user/*
 * 服务间调用，不需要 JWT 认证
 * 仅 Docker 内部网络可访问
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { success } from '@repo/shared';
import * as userService from '../services/user.service';
import * as userRepo from '../repositories/user.repo';
import type { UserProfile } from '../types';

const internal = new Hono<AppEnv>();

// POST /internal/user/detail — 根据 userId 获取用户信息
internal.post('/detail', async (c) => {
  const { id } = await c.req.json<{ id: string }>();
  const user = await userService.getProfile(id);
  return c.json(success(user));
});

// POST /internal/user/batch — 批量获取用户信息
internal.post('/batch', async (c) => {
  const { ids } = await c.req.json<{ ids: string[] }>();
  const users = await userRepo.findByIds(ids);
  // 排除密码字段
  const profiles: UserProfile[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    nickname: u.nickname,
    avatarUrl: u.avatarUrl,
    phone: u.phone,
    status: u.status,
    lastLogin: u.lastLogin,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }));
  return c.json(success(profiles));
});

export default internal;
