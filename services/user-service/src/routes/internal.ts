/**
 * 内部路由 — /internal/user/*
 * 服务间调用，不需要 JWT 认证
 * 仅 Docker 内部网络可访问
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { success } from '@repo/shared';
import { db, users } from '@repo/database';
import { sql, isNull } from 'drizzle-orm';
import * as userService from '../services/user.service';
import * as userRepo from '../repositories/user.repo';
import * as addressRepo from '../repositories/address.repo';
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

// POST /internal/user/address/detail — 根据地址 ID 获取地址信息（order-service 使用）
internal.post('/address/detail', async (c) => {
  const { addressId, userId } = await c.req.json<{ addressId: string; userId: string }>();
  const address = await addressRepo.findById(addressId);
  if (!address || address.userId !== userId) {
    return c.json(success(null));
  }
  return c.json(success(address));
});

// POST /internal/user/stats — 用户概览统计（dashboard 使用）
internal.post('/stats', async (c) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [row] = await db
    .select({
      totalUsers: sql<number>`count(*)::int`,
      newToday: sql<number>`count(*) filter (where ${users.createdAt} >= ${todayStart})::int`,
      activeToday: sql<number>`count(*) filter (where ${users.lastLogin} >= ${todayStart})::int`,
    })
    .from(users)
    .where(isNull(users.deletedAt));

  return c.json(success({
    totalUsers: row?.totalUsers ?? 0,
    newToday: row?.newToday ?? 0,
    activeToday: row?.activeToday ?? 0,
  }));
});

export default internal;
