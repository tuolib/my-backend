import { dbWrite } from '@/db';
import { outboxEvents } from '@/db/schema.ts';
import { eq, and, sql, lte, or, inArray } from 'drizzle-orm';
import { logger } from '@/lib/logger.ts';
import { commitStockToDb } from './inventory.service.ts';

// ========== 查询 ==========

/**
 * 拉取待处理的 outbox 事件
 * status=0(pending) 或 status=2(failed) 且 next_retry_at <= now()
 */
export async function fetchPendingOutbox(limit = 100) {
  return dbWrite
    .select()
    .from(outboxEvents)
    .where(
      and(
        or(
          eq(outboxEvents.status, 0),
          and(
            eq(outboxEvents.status, 2),
            lte(outboxEvents.nextRetryAt, sql`now()`)
          )
        ),
        or(
          sql`${outboxEvents.nextRetryAt} IS NULL`,
          lte(outboxEvents.nextRetryAt, sql`now()`)
        )
      )
    )
    .orderBy(outboxEvents.id)
    .limit(limit);
}

// ========== 状态更新 ==========

export async function markOutboxSent(id: number) {
  await dbWrite
    .update(outboxEvents)
    .set({ status: 1, updatedAt: new Date() })
    .where(eq(outboxEvents.id, id));
}

export async function markOutboxFailed(id: number, err: string) {
  await dbWrite
    .update(outboxEvents)
    .set({
      status: 2,
      lastError: err,
      retryCount: sql`retry_count + 1`,
      // 线性退避：retry_count * 30s
      nextRetryAt: sql`now() + (retry_count + 1) * interval '30 seconds'`,
      updatedAt: new Date(),
    })
    .where(eq(outboxEvents.id, id));
}

// ========== 事件分派处理 ==========

type InventoryPayload = {
  skuId: number;
  qty: number;
  orderId: number;
  idempotencyKey: string;
};

async function handleEvent(event: { id: number; eventType: string; payload: unknown }) {
  switch (event.eventType) {
    case 'inventory.decrement.requested': {
      const p = event.payload as InventoryPayload;
      const result = await commitStockToDb(p.skuId, p.qty, p.orderId, p.idempotencyKey);
      if (!result.ok) {
        throw new Error(result.reason || 'commitStockToDb failed');
      }
      break;
    }
    default:
      // TODO: 接入真实 MQ 后，将未知事件类型发送到消息队列
      logger.warn('outbox: unhandled event type', { eventType: event.eventType, id: event.id });
      break;
  }
}

// ========== 批量处理入口 ==========

export type OutboxBatchResult = {
  total: number;
  sent: number;
  failed: number;
  errors: Array<{ id: number; error: string }>;
};

/**
 * 拉取并处理一批 pending/可重试事件
 */
export async function processPendingOutboxBatch(limit = 100): Promise<OutboxBatchResult> {
  const events = await fetchPendingOutbox(limit);
  const result: OutboxBatchResult = { total: events.length, sent: 0, failed: 0, errors: [] };

  for (const event of events) {
    try {
      await handleEvent(event);
      await markOutboxSent(event.id);
      result.sent++;
      logger.info('outbox: event processed', { id: event.id, eventType: event.eventType });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await markOutboxFailed(event.id, msg);
      result.failed++;
      result.errors.push({ id: event.id, error: msg });
      logger.error('outbox: event failed', { id: event.id, eventType: event.eventType, error: msg });
    }
  }

  return result;
}

/**
 * 简易轮询入口（保留向后兼容）
 */
export async function pollOutboxOnce(limit = 100) {
  const result = await processPendingOutboxBatch(limit);
  return result.total;
}
