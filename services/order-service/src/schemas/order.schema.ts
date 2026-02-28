/**
 * 订单相关 Zod 校验 Schema
 * 注意：不接受前端传价格，服务端从 SKU 实时查询
 */
import { z } from 'zod';

export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        skuId: z.string().min(1, 'skuId 不能为空'),
        quantity: z.number().int().positive('数量必须为正整数'),
      }),
    )
    .min(1, '至少选择一件商品'),
  addressId: z.string().min(1, '收货地址不能为空'),
  remark: z.string().max(500, '备注不超过 500 字').optional(),
});

export const orderListSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(10),
  status: z
    .enum([
      'pending',
      'paid',
      'shipped',
      'delivered',
      'completed',
      'cancelled',
      'refunded',
    ])
    .optional(),
});

export const orderDetailSchema = z.object({
  orderId: z.string().min(1, '订单 ID 不能为空'),
});

export const cancelOrderSchema = z.object({
  orderId: z.string().min(1, '订单 ID 不能为空'),
  reason: z.string().max(500, '取消原因不超过 500 字').optional(),
});

export const shipOrderSchema = z.object({
  orderId: z.string().min(1, '订单 ID 不能为空'),
  trackingNo: z.string().max(100, '物流单号不超过 100 字').optional(),
});
