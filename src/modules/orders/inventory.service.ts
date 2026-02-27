import { redisIns } from '@/lib/redis.ts';
import { logger } from '@/lib/logger.ts';
import {
  appendStockLedger,
  decrementSkuStockInDb,
  createOutboxEvent,
} from './inventory.repository.ts';

const STOCK_KEY_PREFIX = 'stock:';

/**
 * Redis 预扣库存 + 写流水 + 写 outbox 事件
 * 返回 { ok, reason? }
 */
export async function reserveStock(
  skuId: number | bigint,
  qty: number,
  orderId: number | bigint,
  idempotencyKey: string
): Promise<{ ok: boolean; reason?: string }> {
  const redisKey = `${STOCK_KEY_PREFIX}${skuId}`;

  // 1. Redis DECRBY
  const remaining = await redisIns.decrBy(redisKey, qty);

  if (remaining < 0) {
    // 预扣后不足，立即回补
    await redisIns.incrBy(redisKey, qty);
    logger.warn('reserveStock: insufficient stock in Redis', {
      skuId: String(skuId),
      qty,
      orderId: String(orderId),
    });
    return { ok: false, reason: '库存不足' };
  }

  // 2. 写 stock_ledger（幂等）
  const ledgerResult = await appendStockLedger({
    skuId,
    orderId,
    delta: -qty,
    reason: 'reserve',
    idempotencyKey,
  });

  if (!ledgerResult.inserted) {
    // 幂等键冲突 — 已处理过，回补 Redis 避免重复扣减
    await redisIns.incrBy(redisKey, qty);
    logger.info('reserveStock: idempotency key conflict, skipped', {
      idempotencyKey,
      skuId: String(skuId),
    });
    return { ok: true, reason: '幂等跳过（已处理）' };
  }

  // 3. 写 outbox 事件（异步落盘）
  await createOutboxEvent({
    eventType: 'inventory.decrement.requested',
    aggregateType: 'sku',
    aggregateId: String(skuId),
    payload: { skuId: Number(skuId), qty, orderId: Number(orderId), idempotencyKey },
  });

  logger.info('reserveStock: success', {
    skuId: String(skuId),
    qty,
    orderId: String(orderId),
    remaining,
  });

  return { ok: true };
}

/**
 * PG 落盘扣减（由 outbox worker 调用）
 */
export async function commitStockToDb(
  skuId: number | bigint,
  qty: number,
  orderId: number | bigint,
  idempotencyKey: string
): Promise<{ ok: boolean; reason?: string }> {
  const commitKey = `${idempotencyKey}:commit`;

  // PG 原子扣减
  const { success } = await decrementSkuStockInDb(skuId, qty);

  if (!success) {
    logger.error('commitStockToDb: PG stock insufficient or row not found', {
      skuId: String(skuId),
      qty,
    });
    return { ok: false, reason: 'PG 库存不足或 SKU 不存在' };
  }

  // 写 commit 流水（幂等）
  await appendStockLedger({
    skuId,
    orderId,
    delta: -qty,
    reason: 'commit',
    idempotencyKey: commitKey,
  });

  logger.info('commitStockToDb: success', { skuId: String(skuId), qty });
  return { ok: true };
}

/**
 * 回补 Redis + 写 rollback 流水（订单取消/超时）
 */
export async function rollbackReserveStock(
  skuId: number | bigint,
  qty: number,
  orderId: number | bigint,
  idempotencyKey: string
): Promise<{ ok: boolean; reason?: string }> {
  const rollbackKey = `${idempotencyKey}:rollback`;
  const redisKey = `${STOCK_KEY_PREFIX}${skuId}`;

  // 写 rollback 流水（幂等）
  const ledgerResult = await appendStockLedger({
    skuId,
    orderId,
    delta: +qty,
    reason: 'rollback',
    idempotencyKey: rollbackKey,
  });

  if (!ledgerResult.inserted) {
    logger.info('rollbackReserveStock: already rolled back', { rollbackKey });
    return { ok: true, reason: '幂等跳过（已回补）' };
  }

  // Redis 回补
  await redisIns.incrBy(redisKey, qty);

  logger.info('rollbackReserveStock: success', {
    skuId: String(skuId),
    qty,
    orderId: String(orderId),
  });

  return { ok: true };
}
