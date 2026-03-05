/**
 * 商品管理路由 — /api/v1/admin/product/*
 * 需要后台管理员认证（admin JWT）
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import {
  createProductSchema,
  updateProductSchema,
  deleteProductSchema,
} from '../schemas/product.schema';
import { createSkuSchema, updateSkuSchema } from '../schemas/sku.schema';
import { adminAuthMiddleware } from '../middleware';
import * as productService from '../services/product.service';
import * as skuService from '../services/sku.service';
import type { CreateProductInput, UpdateProductInput, CreateSkuInput, UpdateSkuInput } from '../types';

const adminProduct = new Hono<AppEnv>();

// 全部路由需要认证
adminProduct.use('/*', adminAuthMiddleware);

// POST /api/v1/admin/product/create — 创建商品
adminProduct.post('/create', validate(createProductSchema), async (c) => {
  const input = c.get('validated') as CreateProductInput;
  const result = await productService.create(input);
  return c.json(success(result));
});

// POST /api/v1/admin/product/update — 更新商品
adminProduct.post('/update', validate(updateProductSchema), async (c) => {
  const input = c.get('validated') as UpdateProductInput;
  const result = await productService.update(input.id, input);
  return c.json(success(result));
});

// POST /api/v1/admin/product/delete — 删除商品
adminProduct.post('/delete', validate(deleteProductSchema), async (c) => {
  const { id } = c.get('validated') as { id: string };
  await productService.remove(id);
  return c.json(success(null, '商品已删除'));
});

// POST /api/v1/admin/product/sku/create — 创建 SKU
adminProduct.post('/sku/create', validate(createSkuSchema), async (c) => {
  const input = c.get('validated') as CreateSkuInput;
  const result = await skuService.create(input);
  return c.json(success(result));
});

// POST /api/v1/admin/product/sku/update — 更新 SKU
adminProduct.post('/sku/update', validate(updateSkuSchema), async (c) => {
  const input = c.get('validated') as UpdateSkuInput;
  const result = await skuService.update(input);
  return c.json(success(result));
});

export default adminProduct;
