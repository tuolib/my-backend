/**
 * 库存数据访问层 — skus 库存字段 + stock_operations 审计日志
 * DB 层操作：乐观锁确认扣减/释放、管理员调整、操作日志
 */
import { eq, and, sql } from 'drizzle-orm';
import { db, dbRead, skus, stockOperations } from '@repo/database';
import { generateId } from '@repo/shared';

// ── SKU 库存（DB 层）──

/** 获取 SKU 当前库存和版本号（用于乐观锁） */
export async function getSkuStock(
  skuId: string,
): Promise<{ stock: number; version: number } | null> {
  const [row] = await db
    .select({ stock: skus.stock, version: skus.version })
    .from(skus)
    .where(eq(skus.id, skuId));
  return row ?? null;
}

/**
 * 乐观锁确认扣减 — 支付成功后调用
 * WHERE id = :skuId AND version = :currentVersion AND stock >= :quantity
 * 成功返回 true（affected rows > 0）
 */
export async function confirmDeduct(
  skuId: string,
  quantity: number,
  currentVersion: number,
): Promise<boolean> {
  const result = await db
    .update(skus)
    .set({
      stock: sql`${skus.stock} - ${quantity}`,
      version: sql`${skus.version} + 1`,
    })
    .where(
      and(
        eq(skus.id, skuId),
        eq(skus.version, currentVersion),
        sql`${skus.stock} >= ${quantity}`,
      ),
    )
    .returning({ id: skus.id });
  return result.length > 0;
}

/** 确认释放 — 订单取消时 DB 层库存恢复 */
export async function confirmRelease(
  skuId: string,
  quantity: number,
): Promise<void> {
  await db
    .update(skus)
    .set({
      stock: sql`${skus.stock} + ${quantity}`,
      version: sql`${skus.version} + 1`,
    })
    .where(eq(skus.id, skuId));
}

/** 管理员直接设置库存值 */
export async function adjustStock(
  skuId: string,
  newStock: number,
): Promise<void> {
  await db
    .update(skus)
    .set({
      stock: newStock,
      version: sql`${skus.version} + 1`,
    })
    .where(eq(skus.id, skuId));
}

/** 查询所有 active SKU 的库存（用于 Redis 同步，走从库） */
export async function getAllActiveSkuStocks(): Promise<
  Array<{ id: string; stock: number }>
> {
  return dbRead
    .select({ id: skus.id, stock: skus.stock })
    .from(skus)
    .where(eq(skus.status, 'active'));
}

// ── 库存操作日志 ──

/** 记录单条库存操作日志 */
export async function logOperation(data: {
  skuId: string;
  orderId?: string;
  type: 'reserve' | 'confirm' | 'release' | 'adjust';
  quantity: number;
}): Promise<void> {
  await db.insert(stockOperations).values({
    id: generateId(),
    skuId: data.skuId,
    orderId: data.orderId ?? null,
    type: data.type,
    quantity: data.quantity,
  });
}

/** 批量记录库存操作日志 */
export async function logOperationBatch(
  items: Array<{
    skuId: string;
    orderId?: string;
    type: 'reserve' | 'confirm' | 'release' | 'adjust';
    quantity: number;
  }>,
): Promise<void> {
  if (items.length === 0) return;
  await db.insert(stockOperations).values(
    items.map((item) => ({
      id: generateId(),
      skuId: item.skuId,
      orderId: item.orderId ?? null,
      type: item.type,
      quantity: item.quantity,
    })),
  );
}
