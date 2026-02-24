import { z } from 'zod';

export const createOrderSchema = z.object({
  restaurantId: z.number().int().positive('restaurantId 必须为正整数'),
  items: z
    .array(
      z.object({
        menuItemId: z.number().int().positive('menuItemId 必须为正整数'),
        quantity: z.number().int().min(1, '数量至少为 1'),
      })
    )
    .min(1, '至少选择一个菜品'),
  remark: z.string().max(200).optional(),
});

export const payOrderSchema = z.object({
  orderId: z.number().int().positive('orderId 必须为正整数'),
});

export const cancelOrderSchema = z.object({
  orderId: z.number().int().positive('orderId 必须为正整数'),
});

export const listOrderSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'paid', 'completed', 'cancelled']).optional(),
});

export const detailOrderSchema = z.object({
  orderId: z.number().int().positive('orderId 必须为正整数'),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
