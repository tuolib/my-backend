import { dbWrite } from '@/db';
import { outboxEvents } from '@/db/schema.ts';
import { eq, and, sql, lte, or } from 'drizzle-orm';

/**
 * 拉取待发送的 outbox 事件
 * status=0(pending) 且 (next_retry_at IS NULL 或 next_retry_at <= now())
 */
export async function fetchPendingOutbox(limit = 100) {
  return dbWrite
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, 0),
        or(
          sql`${outboxEvents.nextRetryAt} IS NULL`,
          lte(outboxEvents.nextRetryAt, sql`now()`)
        )
      )
    )
    .orderBy(outboxEvents.id)
    .limit(limit);
}

/**
 * 标记事件已发送
 */
export async function markOutboxSent(id: number) {
  await dbWrite
    .update(outboxEvents)
    .set({ status: 1, updatedAt: new Date() })
    .where(eq(outboxEvents.id, id));
}

/**
 * 标记事件发送失败，递增重试计数，设置下次重试时间
 * TODO: 接入真实 MQ 后改为指数退避策略
 */
export async function markOutboxFailed(id: number, err: string) {
  await dbWrite
    .update(outboxEvents)
    .set({
      status: 2,
      lastError: err,
      retryCount: sql`retry_count + 1`,
      // TODO: 指数退避 — 目前固定 60 秒后重试
      nextRetryAt: sql`now() + interval '60 seconds'`,
      updatedAt: new Date(),
    })
    .where(eq(outboxEvents.id, id));
}

/**
 * 轮询入口骨架
 * TODO: 接入 NATS/Redis Stream 发送真实消息
 */
export async function pollOutboxOnce(limit = 100) {
  const events = await fetchPendingOutbox(limit);
  for (const event of events) {
    try {
      // TODO: 发送到 MQ（NATS publish / Redis XADD）
      // await mqClient.publish(event.eventType, JSON.stringify(event.payload));
      await markOutboxSent(event.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await markOutboxFailed(event.id, msg);
    }
  }
  return events.length;
}
