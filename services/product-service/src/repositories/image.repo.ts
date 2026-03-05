/**
 * 商品图片数据访问层 — product_images 表操作
 */
import { eq, asc, inArray } from 'drizzle-orm';
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

/** 按 ID 查找单张图片 */
export async function findById(id: string): Promise<ProductImage | null> {
  const [row] = await db.select().from(productImages).where(eq(productImages.id, id));
  return row ?? null;
}

/** 批量创建图片 */
export async function createMany(images: NewProductImage[]): Promise<ProductImage[]> {
  if (images.length === 0) return [];
  return db.insert(productImages).values(images).returning();
}

/** 按图片 ID 删除 */
export async function deleteById(id: string): Promise<void> {
  await db.delete(productImages).where(eq(productImages.id, id));
}

/** 按商品 ID 删除所有图片 */
export async function deleteByProductId(productId: string): Promise<void> {
  await db.delete(productImages).where(eq(productImages.productId, productId));
}

/** 批量更新排序 */
export async function updateSortOrders(items: { id: string; sortOrder: number }[]): Promise<void> {
  for (const item of items) {
    await db
      .update(productImages)
      .set({ sortOrder: item.sortOrder })
      .where(eq(productImages.id, item.id));
  }
}
