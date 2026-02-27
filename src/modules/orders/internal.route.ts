import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { dbRead } from '@/db';
import { processPendingOutboxBatch } from './outbox.worker.ts';
import { ApiResult } from '@/utils/response.ts';

const internalRoute = new Hono();

// POST /internal/outbox/process — 手动触发 outbox 批量处理（仅开发调试）
internalRoute.post('/outbox/process', async (c) => {
  const result = await processPendingOutboxBatch(100);
  return ApiResult.success(c, result, `处理完毕: ${result.sent} sent, ${result.failed} failed`);
});

// GET /internal/db-ops/health — DB 运维健康检查（只读）
internalRoute.get('/db-ops/health', async (c) => {
  const checks: Record<string, unknown> = {};

  // 1. 分区检查：本月/下月 payments & orders_archive 分区是否存在
  const now = new Date();
  const thisMonth = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${nextDate.getFullYear()}_${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

  const partitionRows = (await dbRead.execute(sql`
    SELECT inhrelid::regclass::TEXT AS name
    FROM pg_inherits
    WHERE inhparent IN ('payments'::regclass, 'orders_archive'::regclass)
  `)) as unknown as Array<{ name: string }>;

  const partNames = Array.isArray(partitionRows)
    ? partitionRows.map((r) => r.name)
    : [];

  checks.partitions = {
    payments_this_month: partNames.includes(`payments_${thisMonth}`),
    payments_next_month: partNames.includes(`payments_${nextMonth}`),
    orders_archive_this_month: partNames.includes(`orders_archive_${thisMonth}`),
    orders_archive_next_month: partNames.includes(`orders_archive_${nextMonth}`),
    total_partitions: partNames.length,
  };

  // 2. Outbox 积压检查
  const outboxRows = (await dbRead.execute(sql`
    SELECT status, count(*)::INT AS cnt
    FROM outbox_events
    GROUP BY status
  `)) as unknown as Array<{ status: number; cnt: number }>;

  const outboxStats: Record<string, number> = { pending: 0, sent: 0, failed: 0 };
  if (Array.isArray(outboxRows)) {
    for (const row of outboxRows) {
      if (row.status === 0) outboxStats.pending = row.cnt;
      else if (row.status === 1) outboxStats.sent = row.cnt;
      else if (row.status === 2) outboxStats.failed = row.cnt;
    }
  }

  const PENDING_WARN_THRESHOLD = 100;
  checks.outbox = {
    ...outboxStats,
    warn: (outboxStats.pending ?? 0) > PENDING_WARN_THRESHOLD,
    threshold: PENDING_WARN_THRESHOLD,
  };

  // 3. 最近归档任务
  const archiveRows = (await dbRead.execute(sql`
    SELECT job_date, status, processed_rows, error_msg, finished_at
    FROM archive_jobs
    ORDER BY job_date DESC LIMIT 3
  `)) as unknown as Array<Record<string, unknown>>;

  checks.recent_archives = Array.isArray(archiveRows) ? archiveRows : [];

  const healthy =
    (checks.partitions as Record<string, unknown>).payments_this_month === true &&
    !checks.outbox || !(checks.outbox as Record<string, unknown>).warn;

  return c.json({ healthy, checks }, healthy ? 200 : 200);
});

export { internalRoute };
