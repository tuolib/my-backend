/**
 * 管理端用户管理 Zod 校验 Schema
 */
import { z } from 'zod';

export const adminUserListSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().max(200).optional(),
  status: z.enum(['active', 'banned']).optional(),
});

export const adminUserDetailSchema = z.object({
  id: z.string().min(1, '用户 ID 不能为空'),
});

export const adminUserToggleStatusSchema = z.object({
  id: z.string().min(1, '用户 ID 不能为空'),
  status: z.enum(['active', 'banned']),
});
