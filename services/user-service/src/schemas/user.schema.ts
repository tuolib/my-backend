/**
 * 用户资料相关 Zod 校验 schema
 */
import { z } from 'zod';

export const updateUserSchema = z.object({
  nickname: z.string().min(1).max(50).optional(),
  avatarUrl: z.string().url('头像链接格式不正确').optional(),
  phone: z.string().max(20).optional(),
});
