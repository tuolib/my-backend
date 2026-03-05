/**
 * 商品管理路由 — /api/v1/admin/product/*
 * 需要后台管理员认证（admin JWT）
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success, paginated } from '@repo/shared';
import {
  createProductSchema,
  updateProductSchema,
  deleteProductSchema,
  adminProductListSchema,
  adminProductDetailSchema,
  toggleProductStatusSchema,
  addProductImageSchema,
  deleteProductImageSchema,
  sortProductImageSchema,
} from '../schemas/product.schema';
import { createSkuSchema, updateSkuSchema, deleteSkuSchema } from '../schemas/sku.schema';
import { adminAuthMiddleware } from '../middleware';
import * as productService from '../services/product.service';
import * as skuService from '../services/sku.service';
import type {
  CreateProductInput,
  UpdateProductInput,
  CreateSkuInput,
  UpdateSkuInput,
  AdminProductListInput,
} from '../types';

const adminProduct = new Hono<AppEnv>();

// 全部路由需要认证
adminProduct.use('/*', adminAuthMiddleware);

// POST /api/v1/admin/product/list — 管理端商品列表
adminProduct.post('/list', validate(adminProductListSchema), async (c) => {
  const input = c.get('validated') as AdminProductListInput;
  const { items, total } = await productService.getAdminList(input);
  return c.json(paginated(items, {
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.ceil(total / input.pageSize),
  }));
});

// POST /api/v1/admin/product/detail — 管理端商品详情
adminProduct.post('/detail', validate(adminProductDetailSchema), async (c) => {
  const { id } = c.get('validated') as { id: string };
  const detail = await productService.getAdminDetail(id);
  return c.json(success(detail));
});

// POST /api/v1/admin/product/toggle-status — 上架/下架
adminProduct.post('/toggle-status', validate(toggleProductStatusSchema), async (c) => {
  const { id, status } = c.get('validated') as { id: string; status: string };
  const result = await productService.toggleStatus(id, status);
  return c.json(success(result));
});

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

// POST /api/v1/admin/product/sku/delete — 删除 SKU
adminProduct.post('/sku/delete', validate(deleteSkuSchema), async (c) => {
  const { skuId } = c.get('validated') as { skuId: string };
  await skuService.remove(skuId);
  return c.json(success(null, 'SKU 已删除'));
});

// POST /api/v1/admin/product/image/add — 添加商品图片
adminProduct.post('/image/add', validate(addProductImageSchema), async (c) => {
  const { productId, images } = c.get('validated') as {
    productId: string;
    images: { url: string; altText?: string; isPrimary?: boolean; sortOrder?: number }[];
  };
  const result = await productService.addImages(productId, images);
  return c.json(success(result));
});

// POST /api/v1/admin/product/image/delete — 删除商品图片
adminProduct.post('/image/delete', validate(deleteProductImageSchema), async (c) => {
  const { imageId } = c.get('validated') as { imageId: string };
  await productService.deleteImage(imageId);
  return c.json(success(null, '图片已删除'));
});

// POST /api/v1/admin/product/image/sort — 图片排序
adminProduct.post('/image/sort', validate(sortProductImageSchema), async (c) => {
  const { productId, imageIds } = c.get('validated') as { productId: string; imageIds: string[] };
  const result = await productService.sortImages(productId, imageIds);
  return c.json(success(result));
});

export default adminProduct;
