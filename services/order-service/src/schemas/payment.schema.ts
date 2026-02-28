/**
 * 支付相关 Zod 校验 Schema
 */
import { z } from 'zod';

export const createPaymentSchema = z.object({
  orderId: z.string().min(1, '订单 ID 不能为空'),
  method: z.enum(['stripe', 'alipay', 'wechat', 'mock']).default('mock'),
});

export const paymentNotifySchema = z.object({
  orderId: z.string().min(1, '订单 ID 不能为空'),
  transactionId: z.string().min(1, '交易 ID 不能为空'),
  status: z.enum(['success', 'failed']),
  amount: z.number().positive('金额必须为正数'),
  method: z.string().min(1),
  rawData: z.record(z.string(), z.unknown()).optional(),
});

export const queryPaymentSchema = z.object({
  orderId: z.string().min(1, '订单 ID 不能为空'),
});
