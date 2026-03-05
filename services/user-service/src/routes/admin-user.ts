/**
 * 管理端用户管理路由 — /api/v1/admin/user/*
 * 需要后台管理员认证（admin JWT）
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success, paginated, createAdminAuthMiddleware } from '@repo/shared';
import {
  adminUserListSchema,
  adminUserDetailSchema,
  adminUserToggleStatusSchema,
} from '../schemas/admin-user.schema';
import * as adminUserService from '../services/admin-user.service';
import type { AdminUserListInput } from '../types';

const adminUser = new Hono<AppEnv>();

// 全局认证
adminUser.use('/*', createAdminAuthMiddleware());

// POST /api/v1/admin/user/list — 用户列表
adminUser.post('/list', validate(adminUserListSchema), async (c) => {
  const input = c.get('validated') as AdminUserListInput;
  const result = await adminUserService.list(input);
  return c.json(paginated(result.items, result.pagination));
});

// POST /api/v1/admin/user/detail — 用户详情
adminUser.post('/detail', validate(adminUserDetailSchema), async (c) => {
  const { id } = c.get('validated') as { id: string };
  const result = await adminUserService.detail(id);
  return c.json(success(result));
});

// POST /api/v1/admin/user/toggle-status — 封禁/解封
adminUser.post('/toggle-status', validate(adminUserToggleStatusSchema), async (c) => {
  const { id, status } = c.get('validated') as { id: string; status: 'active' | 'banned' };
  await adminUserService.toggleStatus(id, status);
  return c.json(success(null, status === 'active' ? '已解封' : '已封禁'));
});

export default adminUser;
