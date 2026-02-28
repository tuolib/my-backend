/**
 * 地址相关 Zod 校验 schema
 */
import { z } from 'zod';

export const createAddressSchema = z.object({
  label: z.string().max(50).optional(),
  recipient: z.string().min(1, '收件人不能为空').max(100),
  phone: z.string().min(1, '手机号不能为空').max(20),
  province: z.string().min(1, '省份不能为空').max(50),
  city: z.string().min(1, '城市不能为空').max(50),
  district: z.string().min(1, '区/县不能为空').max(50),
  address: z.string().min(1, '详细地址不能为空'),
  postalCode: z.string().max(10).optional(),
  isDefault: z.boolean().optional().default(false),
});

export const updateAddressSchema = z.object({
  id: z.string().min(1, '地址 ID 不能为空'),
  label: z.string().max(50).optional(),
  recipient: z.string().min(1).max(100).optional(),
  phone: z.string().min(1).max(20).optional(),
  province: z.string().min(1).max(50).optional(),
  city: z.string().min(1).max(50).optional(),
  district: z.string().min(1).max(50).optional(),
  address: z.string().min(1).optional(),
  postalCode: z.string().max(10).optional(),
  isDefault: z.boolean().optional(),
});

export const deleteAddressSchema = z.object({
  id: z.string().min(1, '地址 ID 不能为空'),
});
