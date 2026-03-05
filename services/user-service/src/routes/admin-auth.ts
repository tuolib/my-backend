/**
 * 管理员认证路由 — /api/v1/admin/auth/*
 * 公开路由：login
 * 需认证路由：change-password, profile
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success, createAdminAuthMiddleware } from '@repo/shared';
import { adminLoginSchema, adminChangePasswordSchema } from '../schemas/admin-auth.schema';
import * as adminAuthService from '../services/admin-auth.service';
import type { AdminLoginInput, AdminChangePasswordInput } from '../types';

const adminAuth = new Hono<AppEnv>();

const adminAuthMiddleware = createAdminAuthMiddleware();

// POST /api/v1/admin/auth/login — 公开
adminAuth.post('/login', validate(adminLoginSchema), async (c) => {
  const input = c.get('validated') as AdminLoginInput;
  const result = await adminAuthService.login(input);
  return c.json(success(result));
});

// POST /api/v1/admin/auth/change-password — 需认证
adminAuth.post('/change-password', adminAuthMiddleware, validate(adminChangePasswordSchema), async (c) => {
  const adminId = c.get('adminId');
  const input = c.get('validated') as AdminChangePasswordInput;
  await adminAuthService.changePassword(adminId, input);
  return c.json(success(null, '密码修改成功'));
});

// POST /api/v1/admin/auth/profile — 需认证，获取当前管理员信息
adminAuth.post('/profile', adminAuthMiddleware, async (c) => {
  const adminId = c.get('adminId');
  const { findById } = await import('../repositories/admin.repo');
  const admin = await findById(adminId);
  if (!admin) {
    const { NotFoundError } = await import('@repo/shared');
    throw new NotFoundError('管理员不存在');
  }
  return c.json(success({
    id: admin.id,
    username: admin.username,
    realName: admin.realName,
    role: admin.role,
    isSuper: admin.isSuper,
    status: admin.status,
    lastLoginAt: admin.lastLoginAt,
    createdAt: admin.createdAt,
  }));
});

export default adminAuth;
