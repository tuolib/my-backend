import { z } from 'zod';

// ── 饭店 ────────────────────────────────────────────────────────────

export const createRestaurantSchema = z.object({
  name: z.string().min(1, '饭店名称必填'),
  description: z.string().optional(),
  address: z.string().min(1, '地址必填'),
  phone: z.string().optional(),
});

export const listRestaurantSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── 菜单项 ──────────────────────────────────────────────────────────

export const listMenuItemSchema = z.object({
  restaurantId: z.number().int().positive('restaurantId 必须为正整数'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createMenuItemSchema = z.object({
  restaurantId: z.number().int().positive('restaurantId 必须为正整数'),
  name: z.string().min(1, '菜品名称必填'),
  description: z.string().optional(),
  price: z.number().positive('价格必须大于 0').multipleOf(0.01, '价格最多两位小数'),
  category: z.string().optional(),
});

export const updateMenuItemSchema = z.object({
  id: z.number().int().positive('id 必须为正整数'),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().positive().multipleOf(0.01).optional(),
  category: z.string().optional(),
  isAvailable: z.boolean().optional(),
});

export const deleteMenuItemSchema = z.object({
  id: z.number().int().positive('id 必须为正整数'),
});

export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
