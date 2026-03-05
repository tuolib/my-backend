/**
 * 管理员认证 & 管理相关 Zod 校验 schema
 */
import { z } from 'zod';

export const adminLoginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

export const adminChangePasswordSchema = z.object({
  oldPassword: z.string().min(1, '旧密码不能为空'),
  newPassword: z.string().min(8, '新密码至少 8 位').max(100),
});

const adminRoleEnum = z.enum(['admin', 'operator', 'viewer']);

export const createAdminSchema = z.object({
  username: z.string().min(2, '用户名至少 2 位').max(50).regex(/^[a-zA-Z0-9_-]+$/, '用户名只允许字母、数字、下划线、短横线'),
  password: z.string().min(8, '密码至少 8 位').max(100),
  realName: z.string().max(50).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email('邮箱格式不正确').optional(),
  role: adminRoleEnum.default('operator'),
});

export const updateAdminSchema = z.object({
  id: z.string().min(1),
  realName: z.string().max(50).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email('邮箱格式不正确').optional(),
  role: adminRoleEnum.optional(),
});

export const adminListSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
});

export const toggleAdminStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['active', 'disabled']),
});

export const resetAdminPasswordSchema = z.object({
  id: z.string().min(1),
  newPassword: z.string().min(8, '密码至少 8 位').max(100),
});
