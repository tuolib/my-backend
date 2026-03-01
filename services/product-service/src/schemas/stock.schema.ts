/**
 * 库存操作 Zod 校验 schema
 */
import { z } from 'zod';

const stockItem = z.object({
  skuId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const reserveSchema = z.object({
  items: z.array(stockItem).min(1),
  orderId: z.string().min(1),
});

export const releaseSchema = z.object({
  items: z.array(stockItem).min(1),
  orderId: z.string().min(1),
});

export const confirmSchema = z.object({
  items: z.array(stockItem).min(1),
  orderId: z.string().min(1),
});

export const syncSchema = z.object({
  forceSync: z.boolean().optional().default(false),
});

export const adjustSchema = z.object({
  skuId: z.string().min(1),
  quantity: z.number().int().min(0),
  reason: z.string().optional(),
});
