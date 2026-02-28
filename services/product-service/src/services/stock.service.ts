/**
 * 库存核心业务逻辑 — 并发安全的预扣/释放/确认/同步/调整
 *
 * 策略：
 *   reserve/release → Redis Lua 脚本原子操作（速度优先）
 *   confirm         → PG 乐观锁（一致性优先）
 *   adjust          → DB 优先 → Redis 同步（管理员低频操作）
 *   sync            → DB 为准对齐 Redis（定时对账）
 */
import { eq, and, sql } from 'drizzle-orm';
import {
  redis,
  db,
  skus,
  stockOperations,
  deductStock,
  deductStockMulti,
  releaseStock,
  releaseStockMulti,
  getStock,
  setStock,
  syncStockToRedis,
} from '@repo/database';
import type { SyncReport } from '@repo/database';
import {
  generateId,
  ValidationError,
  InternalError,
  NotFoundError,
  ErrorCode,
} from '@repo/shared';
import * as stockRepo from '../repositories/stock.repo';
import * as cacheService from './cache.service';
import * as skuRepo from '../repositories/sku.repo';

// ═══════════════════════════════════════════════
// reserve — 库存预扣（下单时调用）
// ═══════════════════════════════════════════════

/** 单 SKU 预扣 */
export async function reserveSingle(
  skuId: string,
  quantity: number,
  orderId: string,
): Promise<void> {
  const { success, code } = await deductStock(redis, skuId, quantity);

  if (!success) {
    if (code === -1) {
      throw new InternalError(`Stock key not found for SKU ${skuId}, run sync`);
    }
    // code === 0 → 库存不足
    const available = await getStock(redis, skuId);
    throw new ValidationError('库存不足', ErrorCode.STOCK_INSUFFICIENT, {
      failedSkuId: skuId,
      available,
    });
  }

  await stockRepo.logOperation({
    skuId,
    orderId,
    type: 'reserve',
    quantity,
  });

  console.log(`[STOCK RESERVE] skuId=${skuId} qty=${quantity} orderId=${orderId}`);
}

/** 多 SKU 原子预扣 */
export async function reserveMulti(
  items: Array<{ skuId: string; quantity: number }>,
  orderId: string,
): Promise<void> {
  const { success, failedIndex } = await deductStockMulti(redis, items);

  if (!success) {
    const failedItem = items[failedIndex! - 1]; // failedIndex 从 1 开始
    const available = await getStock(redis, failedItem.skuId);
    throw new ValidationError('库存不足', ErrorCode.STOCK_INSUFFICIENT, {
      failedSkuId: failedItem.skuId,
      failedIndex: failedIndex! - 1, // 返回给调用方时转为 0-based
      available,
    });
  }

  await stockRepo.logOperationBatch(
    items.map((item) => ({
      skuId: item.skuId,
      orderId,
      type: 'reserve' as const,
      quantity: item.quantity,
    })),
  );

  console.log(
    `[STOCK RESERVE MULTI] orderId=${orderId} items=${JSON.stringify(items)}`,
  );
}

// ═══════════════════════════════════════════════
// release — 库存释放（订单取消/超时）
// ═══════════════════════════════════════════════

/** 单 SKU 释放 */
export async function releaseSingle(
  skuId: string,
  quantity: number,
  orderId: string,
): Promise<void> {
  await releaseStock(redis, skuId, quantity);

  await stockRepo.logOperation({
    skuId,
    orderId,
    type: 'release',
    quantity,
  });

  console.log(`[STOCK RELEASE] skuId=${skuId} qty=${quantity} orderId=${orderId}`);
}

/** 多 SKU 批量释放 */
export async function releaseMulti(
  items: Array<{ skuId: string; quantity: number }>,
  orderId: string,
): Promise<void> {
  await releaseStockMulti(redis, items);

  await stockRepo.logOperationBatch(
    items.map((item) => ({
      skuId: item.skuId,
      orderId,
      type: 'release' as const,
      quantity: item.quantity,
    })),
  );

  console.log(
    `[STOCK RELEASE MULTI] orderId=${orderId} items=${JSON.stringify(items)}`,
  );
}

// ═══════════════════════════════════════════════
// confirm — 库存确认（支付成功后，DB 最终一致）
// ═══════════════════════════════════════════════

const MAX_CONFIRM_RETRIES = 3;

/** 单 SKU 乐观锁确认 */
export async function confirmSingle(
  skuId: string,
  quantity: number,
  orderId: string,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_CONFIRM_RETRIES; attempt++) {
    const skuStock = await stockRepo.getSkuStock(skuId);
    if (!skuStock) {
      throw new NotFoundError(`SKU ${skuId} not found`, ErrorCode.SKU_NOT_FOUND);
    }

    const ok = await stockRepo.confirmDeduct(skuId, quantity, skuStock.version);
    if (ok) {
      await stockRepo.logOperation({
        skuId,
        orderId,
        type: 'confirm',
        quantity,
      });
      console.log(
        `[STOCK CONFIRM] skuId=${skuId} qty=${quantity} orderId=${orderId} version=${skuStock.version}→${skuStock.version + 1}`,
      );
      return;
    }

    console.warn(
      `[STOCK CONFIRM RETRY] skuId=${skuId} attempt=${attempt}/${MAX_CONFIRM_RETRIES} version=${skuStock.version}`,
    );
  }

  // 3 次重试均失败
  console.error(
    `[STOCK CONFIRM FAILED] skuId=${skuId} qty=${quantity} orderId=${orderId} — 乐观锁冲突超过最大重试次数`,
  );
  throw new InternalError(
    `Stock confirm failed after ${MAX_CONFIRM_RETRIES} retries for SKU ${skuId}`,
  );
}

/** 多 SKU 在 PG 事务内确认，任一失败则全部回滚 */
export async function confirmMulti(
  items: Array<{ skuId: string; quantity: number }>,
  orderId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const item of items) {
      for (let attempt = 1; attempt <= MAX_CONFIRM_RETRIES; attempt++) {
        const [skuStock] = await tx
          .select({ stock: skus.stock, version: skus.version })
          .from(skus)
          .where(eq(skus.id, item.skuId));

        if (!skuStock) {
          throw new NotFoundError(
            `SKU ${item.skuId} not found`,
            ErrorCode.SKU_NOT_FOUND,
          );
        }

        const result = await tx
          .update(skus)
          .set({
            stock: sql`${skus.stock} - ${item.quantity}`,
            version: sql`${skus.version} + 1`,
          })
          .where(
            and(
              eq(skus.id, item.skuId),
              eq(skus.version, skuStock.version),
              sql`${skus.stock} >= ${item.quantity}`,
            ),
          )
          .returning({ id: skus.id });

        if (result.length > 0) {
          await tx.insert(stockOperations).values({
            id: generateId(),
            skuId: item.skuId,
            orderId,
            type: 'confirm',
            quantity: item.quantity,
          });

          console.log(
            `[STOCK CONFIRM] skuId=${item.skuId} qty=${item.quantity} orderId=${orderId} version=${skuStock.version}→${skuStock.version + 1}`,
          );
          break;
        }

        if (attempt === MAX_CONFIRM_RETRIES) {
          throw new InternalError(
            `Stock confirm failed after ${MAX_CONFIRM_RETRIES} retries for SKU ${item.skuId}`,
          );
        }

        console.warn(
          `[STOCK CONFIRM RETRY] skuId=${item.skuId} attempt=${attempt}/${MAX_CONFIRM_RETRIES}`,
        );
      }
    }
  });
}

// ═══════════════════════════════════════════════
// sync — Redis ↔ DB 库存同步
// ═══════════════════════════════════════════════

export async function syncAll(
  options?: { forceSync?: boolean },
): Promise<SyncReport> {
  const forceSync = options?.forceSync ?? false;
  return syncStockToRedis(db, redis, { forceSync, dryRun: !forceSync });
}

// ═══════════════════════════════════════════════
// adjust — 管理员手动调整库存
// ═══════════════════════════════════════════════

export async function adjust(
  skuId: string,
  newStock: number,
  reason?: string,
): Promise<void> {
  // 检查 SKU 是否存在
  const sku = await skuRepo.findById(skuId);
  if (!sku) {
    throw new NotFoundError('SKU 不存在', ErrorCode.SKU_NOT_FOUND);
  }

  // 1. DB 优先：先写 DB
  await stockRepo.adjustStock(skuId, newStock);

  // 2. 再写 Redis
  await setStock(redis, skuId, newStock);

  // 3. 记录操作日志
  await stockRepo.logOperation({
    skuId,
    type: 'adjust',
    quantity: newStock,
  });

  // 4. 清除该 SKU 所属商品的详情缓存
  await cacheService.invalidateProductDetail(sku.productId);

  console.log(
    `[STOCK ADJUST] skuId=${skuId} newStock=${newStock} reason=${reason ?? 'N/A'}`,
  );
}
