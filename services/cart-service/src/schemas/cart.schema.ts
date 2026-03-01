/**
 * 购物车相关 Zod 校验 schema
 */
import { z } from 'zod';

export const addCartSchema = z.object({
  skuId: z.string().min(1, 'skuId 不能为空'),
  quantity: z.number().int().positive('数量必须为正整数').max(99, '单次最多添加 99 件'),
});

export const updateCartSchema = z.object({
  skuId: z.string().min(1, 'skuId 不能为空'),
  quantity: z.number().int().min(0, '数量不能为负').max(99, '单次最多 99 件'),
});

export const removeCartSchema = z.object({
  skuIds: z.array(z.string().min(1)).min(1, '至少选择一个商品'),
});

export const selectCartSchema = z.object({
  skuIds: z.array(z.string().min(1)).min(1, '至少选择一个商品'),
  selected: z.boolean(),
});

export const clearItemsSchema = z.object({
  userId: z.string().min(1, 'userId 不能为空'),
  skuIds: z.array(z.string().min(1)).min(1, '至少选择一个商品'),
});
