import { Hono } from 'hono';
import { processPendingOutboxBatch } from './outbox.worker.ts';
import { ApiResult } from '@/utils/response.ts';

const internalRoute = new Hono();

// POST /internal/outbox/process — 手动触发 outbox 批量处理（仅开发调试）
internalRoute.post('/outbox/process', async (c) => {
  const result = await processPendingOutboxBatch(100);
  return ApiResult.success(c, result, `处理完毕: ${result.sent} sent, ${result.failed} failed`);
});

export { internalRoute };
