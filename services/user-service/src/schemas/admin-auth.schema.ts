/**
 * 管理员认证相关 Zod 校验 schema
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
