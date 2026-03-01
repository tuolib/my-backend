/**
 * 商品公开路由 — /api/v1/product/*
 * 无需认证，面向前端消费者
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success, paginated } from '@repo/shared';
import { productListSchema, productDetailSchema, productSearchSchema } from '../schemas/product.schema';
import { skuListSchema } from '../schemas/sku.schema';
import * as productService from '../services/product.service';
import * as skuService from '../services/sku.service';
import * as searchService from '../services/search.service';
import type { ProductListInput, SearchInput } from '../types';

const product = new Hono<AppEnv>();

// POST /api/v1/product/list — 商品列表
product.post('/list', validate(productListSchema), async (c) => {
  const input = c.get('validated') as ProductListInput;
  const { items, total } = await productService.getList(input);
  return c.json(paginated(items, {
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.ceil(total / input.pageSize),
  }));
});

// POST /api/v1/product/detail — 商品详情
product.post('/detail', validate(productDetailSchema), async (c) => {
  const { id } = c.get('validated') as { id: string };
  const detail = await productService.getDetail(id);
  return c.json(success(detail));
});

// POST /api/v1/product/search — 商品搜索
product.post('/search', validate(productSearchSchema), async (c) => {
  const input = c.get('validated') as SearchInput;
  const result = await searchService.search(input);
  return c.json(success(result));
});

// POST /api/v1/product/sku/list — 商品 SKU 列表
product.post('/sku/list', validate(skuListSchema), async (c) => {
  const { productId } = c.get('validated') as { productId: string };
  const skuList = await skuService.listByProduct(productId);
  return c.json(success(skuList));
});

export default product;
