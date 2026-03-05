/**
 * SKU 业务逻辑 — 查询、创建（含 Redis 库存初始化）、更新
 * 注意：stock 不允许通过 update 直接修改，只能通过库存专用接口管理
 */
import {
  generateId,
  NotFoundError,
  ConflictError,
  BizError,
  ErrorCode,
} from '@repo/shared';
import { redis, setStock } from '@repo/database';
import * as skuRepo from '../repositories/sku.repo';
import * as productRepo from '../repositories/product.repo';
import * as cacheService from './cache.service';
import type { CreateSkuInput, UpdateSkuInput } from '../types';
import type { Sku } from '@repo/database';

/** 查询商品下所有 SKU */
export async function listByProduct(productId: string): Promise<Sku[]> {
  const product = await productRepo.findById(productId);
  if (!product) {
    throw new NotFoundError('商品不存在', ErrorCode.PRODUCT_NOT_FOUND);
  }
  return skuRepo.findByProductId(productId);
}

/** Admin：创建 SKU */
export async function create(input: CreateSkuInput): Promise<Sku> {
  // 1. 检查商品是否存在
  const product = await productRepo.findById(input.productId);
  if (!product) {
    throw new NotFoundError('商品不存在', ErrorCode.PRODUCT_NOT_FOUND);
  }

  // 2. 检查 sku_code 唯一性
  const existing = await skuRepo.findBySkuCode(input.skuCode);
  if (existing) {
    throw new ConflictError('SKU 编码已存在', ErrorCode.DUPLICATE_SKU_CODE);
  }

  // 3. 创建 SKU
  const sku = await skuRepo.create({
    id: generateId(),
    productId: input.productId,
    skuCode: input.skuCode,
    price: input.price.toString(),
    comparePrice: input.comparePrice?.toString() ?? null,
    costPrice: input.costPrice?.toString() ?? null,
    stock: input.stock,
    lowStock: input.lowStock ?? 5,
    weight: input.weight?.toString() ?? null,
    attributes: input.attributes,
    barcode: input.barcode ?? null,
  });

  // 4. Redis 初始化库存
  await setStock(redis, sku.id, input.stock);

  // 5. 更新 product 的 min_price/max_price
  await productRepo.updatePriceRange(input.productId);

  // 6. 清除商品详情缓存
  await cacheService.invalidateProductDetail(input.productId);

  return sku;
}

/** Admin：删除 SKU */
export async function remove(skuId: string): Promise<void> {
  const existing = await skuRepo.findById(skuId);
  if (!existing) {
    throw new NotFoundError('SKU 不存在', ErrorCode.SKU_NOT_FOUND);
  }

  // 删除 SKU
  await skuRepo.deleteById(skuId);

  // 清除 Redis 库存
  await redis.del(`stock:${skuId}`);

  // 更新 product 价格区间
  await productRepo.updatePriceRange(existing.productId);

  // 清除商品详情缓存
  await cacheService.invalidateProductDetail(existing.productId);
}

/** Admin：更新 SKU（不允许直接改 stock） */
export async function update(input: UpdateSkuInput): Promise<Sku> {
  const existing = await skuRepo.findById(input.skuId);
  if (!existing) {
    throw new NotFoundError('SKU 不存在', ErrorCode.SKU_NOT_FOUND);
  }

  const updateData: Record<string, unknown> = {};
  if (input.price !== undefined) updateData.price = input.price.toString();
  if (input.comparePrice !== undefined) updateData.comparePrice = input.comparePrice?.toString() ?? null;
  if (input.costPrice !== undefined) updateData.costPrice = input.costPrice?.toString() ?? null;
  if (input.lowStock !== undefined) updateData.lowStock = input.lowStock;
  if (input.weight !== undefined) updateData.weight = input.weight?.toString() ?? null;
  if (input.attributes !== undefined) updateData.attributes = input.attributes;
  if (input.barcode !== undefined) updateData.barcode = input.barcode;
  if (input.status !== undefined) updateData.status = input.status;

  const updated = await skuRepo.updateById(input.skuId, updateData as any);
  if (!updated) {
    throw new NotFoundError('SKU 不存在', ErrorCode.SKU_NOT_FOUND);
  }

  // 如果价格或状态变了，更新 product 价格区间
  if (input.price !== undefined || input.status !== undefined) {
    await productRepo.updatePriceRange(existing.productId);
  }

  // 清除商品详情缓存
  await cacheService.invalidateProductDetail(existing.productId);

  return updated;
}
