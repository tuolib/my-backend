/**
 * 认证相关 Zod 校验 schema
 */
import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(8, '密码至少 8 位').max(100),
  nickname: z.string().min(1).max(50).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(1, '密码不能为空'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken 不能为空'),
});
