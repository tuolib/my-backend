/**
 * 商品业务逻辑 — 查询、详情、Admin CRUD
 * 缓存策略：详情 Cache-Aside，列表不缓存
 */
import {
  generateId,
  NotFoundError,
  ErrorCode,
} from '@repo/shared';
import { db, productCategories } from '@repo/database';
import { eq } from 'drizzle-orm';
import * as productRepo from '../repositories/product.repo';
import * as imageRepo from '../repositories/image.repo';
import * as skuRepo from '../repositories/sku.repo';
import * as categoryRepo from '../repositories/category.repo';
import * as cacheService from './cache.service';
import type {
  ProductDetail,
  ProductListItem,
  ProductListInput,
  CreateProductInput,
  UpdateProductInput,
} from '../types';

/** 生成 slug：转小写 + 空格替换为 - + 去除特殊字符 + 追加短 ID */
function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base}-${generateId().slice(0, 6)}`;
}

/** 获取商品详情（含 SKU、图片、分类） */
export async function getDetail(productId: string): Promise<ProductDetail> {
  // 1. 查缓存
  const cached = await cacheService.getCachedProductDetail(productId);
  if (cached === 'empty') {
    throw new NotFoundError('商品不存在', ErrorCode.PRODUCT_NOT_FOUND);
  }
  if (cached !== null) {
    return cached;
  }

  // 2. 查 DB
  const product = await productRepo.findById(productId);
  if (!product) {
    await cacheService.setCachedProductDetail(productId, null);
    throw new NotFoundError('商品不存在', ErrorCode.PRODUCT_NOT_FOUND);
  }

  // 3. 查关联数据
  const [images, skuList, pcRows] = await Promise.all([
    imageRepo.findByProductId(productId),
    skuRepo.findByProductId(productId),
    db.select().from(productCategories).where(eq(productCategories.productId, productId)),
  ]);

  // 获取分类详情
  const categoryIds = pcRows.map((r) => r.categoryId);
  const cats = await Promise.all(categoryIds.map((id) => categoryRepo.findById(id)));

  // 4. 组装
  const detail: ProductDetail = {
    id: product.id,
    title: product.title,
    slug: product.slug,
    description: product.description,
    brand: product.brand,
    status: product.status,
    attributes: product.attributes,
    minPrice: product.minPrice,
    maxPrice: product.maxPrice,
    totalSales: product.totalSales,
    avgRating: product.avgRating,
    reviewCount: product.reviewCount,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    images: images.map((img) => ({
      id: img.id,
      url: img.url,
      altText: img.altText,
      isPrimary: img.isPrimary,
      sortOrder: img.sortOrder,
    })),
    skus: skuList.map((s) => ({
      id: s.id,
      skuCode: s.skuCode,
      price: s.price,
      comparePrice: s.comparePrice,
      stock: s.stock,
      attributes: s.attributes,
      status: s.status,
    })),
    categories: cats
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
  };

  // 5. 写缓存
  await cacheService.setCachedProductDetail(productId, detail);

  return detail;
}

/** 商品列表（不缓存，直接查 DB） */
export async function getList(params: ProductListInput): Promise<{
  items: ProductListItem[];
  total: number;
}> {
  const { items: rawItems, total } = await productRepo.findList(params);

  // 批量查首图
  const productIds = rawItems.map((p) => p.id);
  const allImages = await Promise.all(productIds.map((id) => imageRepo.findByProductId(id)));

  const items: ProductListItem[] = rawItems.map((p, i) => {
    const primaryImg = allImages[i].find((img) => img.isPrimary) ?? allImages[i][0] ?? null;
    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      brand: p.brand,
      status: p.status,
      minPrice: p.minPrice,
      maxPrice: p.maxPrice,
      totalSales: p.totalSales,
      avgRating: p.avgRating,
      reviewCount: p.reviewCount,
      primaryImage: primaryImg?.url ?? null,
      createdAt: p.createdAt,
    };
  });

  return { items, total };
}

/** Admin：创建商品 */
export async function create(input: CreateProductInput): Promise<ProductDetail> {
  const slug = input.slug || generateSlug(input.title);

  // 创建商品
  const product = await productRepo.create({
    id: generateId(),
    title: input.title,
    slug,
    description: input.description ?? null,
    brand: input.brand ?? null,
    status: input.status ?? 'draft',
    attributes: input.attributes ?? null,
  });

  // 关联分类
  if (input.categoryIds.length > 0) {
    await db.insert(productCategories).values(
      input.categoryIds.map((catId) => ({
        productId: product.id,
        categoryId: catId,
      })),
    );
  }

  // 创建图片
  if (input.images && input.images.length > 0) {
    await imageRepo.createMany(
      input.images.map((img, i) => ({
        id: generateId(),
        productId: product.id,
        url: img.url,
        altText: img.altText ?? null,
        isPrimary: img.isPrimary ?? i === 0,
        sortOrder: img.sortOrder ?? i,
      })),
    );
  }

  // 清除分类树缓存
  await cacheService.invalidateCategoryTree();

  return getDetail(product.id);
}

/** Admin：更新商品 */
export async function update(productId: string, input: UpdateProductInput): Promise<ProductDetail> {
  const existing = await productRepo.findById(productId);
  if (!existing) {
    throw new NotFoundError('商品不存在', ErrorCode.PRODUCT_NOT_FOUND);
  }

  // 更新基本字段
  const updateData: Record<string, unknown> = {};
  if (input.title !== undefined) updateData.title = input.title;
  if (input.slug !== undefined) updateData.slug = input.slug;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.brand !== undefined) updateData.brand = input.brand;
  if (input.status !== undefined) updateData.status = input.status;
  if (input.attributes !== undefined) updateData.attributes = input.attributes;

  if (Object.keys(updateData).length > 0) {
    await productRepo.updateById(productId, updateData as any);
  }

  // 更新分类关联
  if (input.categoryIds !== undefined) {
    await db.delete(productCategories).where(eq(productCategories.productId, productId));
    if (input.categoryIds.length > 0) {
      await db.insert(productCategories).values(
        input.categoryIds.map((catId) => ({
          productId,
          categoryId: catId,
        })),
      );
    }
  }

  // 更新图片
  if (input.images !== undefined) {
    await imageRepo.deleteByProductId(productId);
    if (input.images.length > 0) {
      await imageRepo.createMany(
        input.images.map((img, i) => ({
          id: generateId(),
          productId,
          url: img.url,
          altText: img.altText ?? null,
          isPrimary: img.isPrimary ?? i === 0,
          sortOrder: img.sortOrder ?? i,
        })),
      );
    }
  }

  // 清除缓存
  await cacheService.invalidateProductDetail(productId);
  await cacheService.invalidateCategoryTree();

  return getDetail(productId);
}

/** Admin：软删除商品 */
export async function remove(productId: string): Promise<void> {
  const existing = await productRepo.findById(productId);
  if (!existing) {
    throw new NotFoundError('商品不存在', ErrorCode.PRODUCT_NOT_FOUND);
  }

  await productRepo.softDelete(productId);
  await cacheService.invalidateProductDetail(productId);
  await cacheService.invalidateCategoryTree();
}
