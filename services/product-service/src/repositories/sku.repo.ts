/**
 * SKU 数据访问层 — skus 表操作
 */
import { eq, and, inArray } from 'drizzle-orm';
import { db, skus } from '@repo/database';
import type { Sku, NewSku } from '@repo/database';

/** 按 ID 查找 */
export async function findById(id: string): Promise<Sku | null> {
  const [row] = await db.select().from(skus).where(eq(skus.id, id));
  return row ?? null;
}

/** 按商品 ID 查找所有 SKU */
export async function findByProductId(productId: string): Promise<Sku[]> {
  return db.select().from(skus).where(eq(skus.productId, productId));
}

/** 批量按 ID 查找 */
export async function findByIds(ids: string[]): Promise<Sku[]> {
  if (ids.length === 0) return [];
  return db.select().from(skus).where(inArray(skus.id, ids));
}

/** 按 skuCode 查找 */
export async function findBySkuCode(code: string): Promise<Sku | null> {
  const [row] = await db.select().from(skus).where(eq(skus.skuCode, code));
  return row ?? null;
}

/** 创建 SKU */
export async function create(data: NewSku): Promise<Sku> {
  const [row] = await db.insert(skus).values(data).returning();
  return row;
}

/** 按 ID 更新 SKU（不包含 stock 字段，stock 通过库存专用接口管理） */
export async function updateById(
  id: string,
  data: Partial<Pick<Sku, 'price' | 'comparePrice' | 'costPrice' | 'lowStock' | 'weight' | 'attributes' | 'barcode' | 'status'>>,
): Promise<Sku | null> {
  const [row] = await db
    .update(skus)
    .set(data)
    .where(eq(skus.id, id))
    .returning();
  return row ?? null;
}
