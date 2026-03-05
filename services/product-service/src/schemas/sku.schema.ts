/**
 * SKU 相关 Zod 校验 schema
 */
import { z } from 'zod';

export const skuListSchema = z.object({
  productId: z.string().min(1),
});

export const createSkuSchema = z.object({
  productId: z.string().min(1),
  skuCode: z.string().min(1).max(50),
  price: z.number().positive(),
  comparePrice: z.number().positive().optional(),
  costPrice: z.number().positive().optional(),
  stock: z.number().int().min(0).default(0),
  lowStock: z.number().int().min(0).default(5),
  weight: z.number().min(0).optional(),
  attributes: z.record(z.string(), z.string()),
  barcode: z.string().max(50).optional(),
});

export const deleteSkuSchema = z.object({
  skuId: z.string().min(1),
});

export const updateSkuSchema = z.object({
  skuId: z.string().min(1),
  price: z.number().positive().optional(),
  comparePrice: z.number().positive().nullable().optional(),
  costPrice: z.number().positive().nullable().optional(),
  lowStock: z.number().int().min(0).optional(),
  weight: z.number().min(0).nullable().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  barcode: z.string().max(50).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
