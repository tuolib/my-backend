/**
 * 商品图片数据访问层 — product_images 表操作
 */
import { eq, asc } from 'drizzle-orm';
import { db, productImages } from '@repo/database';
import type { ProductImage, NewProductImage } from '@repo/database';

/** 按商品 ID 查找所有图片 */
export async function findByProductId(productId: string): Promise<ProductImage[]> {
  return db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.sortOrder));
}

/** 批量创建图片 */
export async function createMany(images: NewProductImage[]): Promise<ProductImage[]> {
  if (images.length === 0) return [];
  return db.insert(productImages).values(images).returning();
}

/** 按商品 ID 删除所有图片 */
export async function deleteByProductId(productId: string): Promise<void> {
  await db.delete(productImages).where(eq(productImages.productId, productId));
}
