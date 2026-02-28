/**
 * 内部路由 — /internal/product/*
 * 服务间调用，不需要 JWT 认证
 * 仅 Docker 内部网络可访问
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { success } from '@repo/shared';
import * as skuRepo from '../repositories/sku.repo';
import * as productRepo from '../repositories/product.repo';
import * as imageRepo from '../repositories/image.repo';
import type { SkuBatchItem } from '../types';

const internal = new Hono<AppEnv>();

// POST /internal/product/sku/batch — 批量查询 SKU 详情（含商品基本信息 + 首图）
internal.post('/sku/batch', async (c) => {
  const { skuIds } = await c.req.json<{ skuIds: string[] }>();

  if (!skuIds || skuIds.length === 0) {
    return c.json(success([]));
  }

  const skuList = await skuRepo.findByIds(skuIds);
  if (skuList.length === 0) {
    return c.json(success([]));
  }

  // 获取关联的商品和图片
  const productIds = [...new Set(skuList.map((s) => s.productId))];
  const [productsData, imagesData] = await Promise.all([
    Promise.all(productIds.map((id) => productRepo.findById(id))),
    Promise.all(productIds.map((id) => imageRepo.findByProductId(id))),
  ]);

  // 构建映射
  const productMap = new Map(productsData.filter(Boolean).map((p) => [p!.id, p!]));
  const imageMap = new Map(productIds.map((id, i) => {
    const primary = imagesData[i].find((img) => img.isPrimary) ?? imagesData[i][0] ?? null;
    return [id, primary?.url ?? null];
  }));

  const result: SkuBatchItem[] = skuList.map((s) => {
    const product = productMap.get(s.productId);
    return {
      id: s.id,
      skuCode: s.skuCode,
      price: s.price,
      stock: s.stock,
      status: s.status,
      attributes: s.attributes,
      productId: s.productId,
      productTitle: product?.title ?? '',
      productSlug: product?.slug ?? '',
      primaryImage: imageMap.get(s.productId) ?? null,
    };
  });

  return c.json(success(result));
});

export default internal;
