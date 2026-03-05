/**
 * 商品相关 Zod 校验 schema
 */
import { z } from 'zod';

export const productListSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sort: z.enum(['createdAt', 'price', 'sales']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  filters: z.object({
    status: z.enum(['active', 'draft', 'archived']).optional(),
    categoryId: z.string().optional(),
    brand: z.string().optional(),
  }).optional(),
});

export const productDetailSchema = z.object({
  id: z.string().min(1),
});

export const productSearchSchema = z.object({
  keyword: z.string().min(1).max(200),
  categoryId: z.string().optional(),
  priceMin: z.number().min(0).optional(),
  priceMax: z.number().min(0).optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'sales', 'newest']).default('relevance'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const createProductSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  brand: z.string().max(100).optional(),
  status: z.enum(['draft', 'active']).default('draft'),
  attributes: z.record(z.string(), z.unknown()).optional(),
  categoryIds: z.array(z.string()).min(1),
  images: z.array(z.object({
    url: z.string().url(),
    altText: z.string().max(200).optional(),
    isPrimary: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })).optional(),
});

export const updateProductSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  brand: z.string().max(100).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  categoryIds: z.array(z.string()).min(1).optional(),
  images: z.array(z.object({
    url: z.string().url(),
    altText: z.string().max(200).optional(),
    isPrimary: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })).optional(),
});

export const deleteProductSchema = z.object({
  id: z.string().min(1),
});

// ── Phase 1: Admin 商品管理补全 ──

export const adminProductListSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sort: z.enum(['createdAt', 'price', 'sales']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  keyword: z.string().max(200).optional(),
  filters: z.object({
    status: z.enum(['active', 'draft', 'archived']).optional(),
    categoryId: z.string().optional(),
    brand: z.string().optional(),
  }).optional(),
});

export const adminProductDetailSchema = z.object({
  id: z.string().min(1),
});

export const toggleProductStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['active', 'draft', 'archived']),
});

export const deleteSkuSchema = z.object({
  skuId: z.string().min(1),
});

export const addProductImageSchema = z.object({
  productId: z.string().min(1),
  images: z.array(z.object({
    url: z.string().url(),
    altText: z.string().max(200).optional(),
    isPrimary: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })).min(1),
});

export const deleteProductImageSchema = z.object({
  imageId: z.string().min(1),
});

export const sortProductImageSchema = z.object({
  productId: z.string().min(1),
  imageIds: z.array(z.string().min(1)).min(1),
});
