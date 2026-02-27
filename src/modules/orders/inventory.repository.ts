import { dbWrite } from '@/db';
import { skus, stockLedger, outboxEvents } from '@/db/schema.ts';
import { eq, sql, and, gte } from 'drizzle-orm';

// ========== 辅助 ==========

function getErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  // Direct PG error
  if ('code' in err && typeof (err as Record<string, unknown>).code === 'string') {
    return (err as { code: string }).code;
  }
  // Drizzle wraps PG error in .cause
  if ('cause' in err) {
    const cause = (err as { cause: unknown }).cause;
    if (typeof cause === 'object' && cause !== null && 'code' in cause) {
      return (cause as { code: string }).code;
    }
  }
  return undefined;
}

// ========== 库存流水 ==========

export type StockLedgerInput = {
  skuId: number | bigint;
  orderId?: number | bigint;
  delta: number;
  reason: 'reserve' | 'commit' | 'rollback' | 'manual';
  idempotencyKey: string;
};

/**
 * 写入库存流水（幂等键冲突时返回 { inserted: false }）
 */
export async function appendStockLedger(input: StockLedgerInput) {
  try {
    const [row] = await dbWrite
      .insert(stockLedger)
      .values({
        skuId: Number(input.skuId),
        orderId: input.orderId != null ? Number(input.orderId) : null,
        delta: input.delta,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    return { inserted: true, row };
  } catch (err: unknown) {
    // PostgreSQL unique_violation = 23505
    // Drizzle wraps the PG error: check both err.code and err.cause.code
    const pgCode = getErrorCode(err);
    if (pgCode === '23505') {
      return { inserted: false, row: null };
    }
    throw err;
  }
}

// ========== SKU 库存落盘 ==========

/**
 * PG 层原子扣减库存：UPDATE skus SET stock = stock - qty WHERE id = ? AND stock >= qty
 * 返回是否成功（affected rows > 0）
 */
export async function decrementSkuStockInDb(skuId: bigint | number, qty: number) {
  const result = await dbWrite.execute(
    sql`UPDATE skus SET stock = stock - ${qty} WHERE id = ${Number(skuId)} AND stock >= ${qty}`
  );
  // postgres-js uses .count; drizzle may wrap as .rowCount — check both
  const rowCount = (result as any).rowCount ?? (result as any).count ?? 0;
  return { success: rowCount > 0, rowCount };
}

// ========== 出站事件 ==========

export type OutboxEventInput = {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
};

/**
 * 创建一条 pending 出站事件
 */
export async function createOutboxEvent(input: OutboxEventInput) {
  const [row] = await dbWrite
    .insert(outboxEvents)
    .values({
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      status: 0,
      retryCount: 0,
    })
    .returning();
  return row;
}
