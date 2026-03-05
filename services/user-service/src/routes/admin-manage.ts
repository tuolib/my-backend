/**
 * 管理员管理路由 — /api/v1/admin/manage/*
 * 全部需要认证 + 超级管理员权限
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success, paginated, createAdminAuthMiddleware, requireSuperAdmin } from '@repo/shared';
import {
  createAdminSchema,
  updateAdminSchema,
  adminListSchema,
  toggleAdminStatusSchema,
  resetAdminPasswordSchema,
} from '../schemas/admin-auth.schema';
import * as adminManageService from '../services/admin-manage.service';
import type { CreateAdminInput, UpdateAdminInput, AdminListInput } from '../types';

const adminManage = new Hono<AppEnv>();

// 全部路由需要 admin 认证 + 超级管理员
adminManage.use('/*', createAdminAuthMiddleware());
adminManage.use('/*', requireSuperAdmin);

// POST /api/v1/admin/manage/create — 创建管理员
adminManage.post('/create', validate(createAdminSchema), async (c) => {
  const input = c.get('validated') as CreateAdminInput;
  const result = await adminManageService.create(input);
  return c.json(success(result));
});

// POST /api/v1/admin/manage/list — 管理员列表
adminManage.post('/list', validate(adminListSchema), async (c) => {
  const input = c.get('validated') as AdminListInput;
  const result = await adminManageService.list(input);
  return c.json(paginated(result.items, result.pagination));
});

// POST /api/v1/admin/manage/update — 更新管理员信息
adminManage.post('/update', validate(updateAdminSchema), async (c) => {
  const input = c.get('validated') as UpdateAdminInput;
  const result = await adminManageService.update(input);
  return c.json(success(result));
});

// POST /api/v1/admin/manage/toggle-status — 启用/禁用管理员
adminManage.post('/toggle-status', validate(toggleAdminStatusSchema), async (c) => {
  const { id, status } = c.get('validated') as { id: string; status: 'active' | 'disabled' };
  await adminManageService.toggleStatus(id, status);
  return c.json(success(null, status === 'active' ? '已启用' : '已禁用'));
});

// POST /api/v1/admin/manage/reset-password — 重置管理员密码
adminManage.post('/reset-password', validate(resetAdminPasswordSchema), async (c) => {
  const { id, newPassword } = c.get('validated') as { id: string; newPassword: string };
  await adminManageService.resetPassword(id, newPassword);
  return c.json(success(null, '密码已重置，该管理员下次登录需修改密码'));
});

export default adminManage;
