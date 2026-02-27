/**
 * 阶段三故障恢复演练
 * 用法: bun run scripts/db/drill-stage3-recovery.ts
 */
import { sql } from 'drizzle-orm';
import { dbWrite, closeDbConnections } from '../../src/db/index.ts';
import {
  appendStockLedger,
  createOutboxEvent,
} from '../../src/modules/orders/inventory.repository.ts';
import { processPendingOutboxBatch } from '../../src/modules/orders/outbox.worker.ts';

type DrillResult = { scenario: string; expected: string; actual: string; pass: boolean };
const drills: DrillResult[] = [];

function record(scenario: string, expected: string, actual: string, pass: boolean) {
  drills.push({ scenario, expected, actual, pass });
  const icon = pass ? '✅' : '❌';
  console.log(`  ${icon} ${scenario}`);
  console.log(`     预期: ${expected}`);
  console.log(`     实际: ${actual}`);
  console.log('');
}

// ── 准备测试 SKU ──────────────────────────────────────────────
const DRILL_SKU = 88888;

async function setup() {
  await dbWrite.execute(sql`
    INSERT INTO products (id, title, category_id, price)
    VALUES (${DRILL_SKU}, 'drill-product', 1, 1.00)
    ON CONFLICT DO NOTHING
  `);
  await dbWrite.execute(sql`
    INSERT INTO skus (id, product_id, stock)
    VALUES (${DRILL_SKU}, ${DRILL_SKU}, 100)
    ON CONFLICT DO NOTHING
  `);
  await dbWrite.execute(sql`UPDATE skus SET stock = 100 WHERE id = ${DRILL_SKU}`);
}

async function cleanup() {
  await dbWrite.execute(sql`DELETE FROM stock_ledger WHERE sku_id = ${DRILL_SKU}`);
  await dbWrite.execute(sql`DELETE FROM outbox_events WHERE aggregate_id = ${String(DRILL_SKU)}`);
  await dbWrite.execute(sql`DELETE FROM skus WHERE id = ${DRILL_SKU}`);
  await dbWrite.execute(sql`DELETE FROM products WHERE id = ${DRILL_SKU}`);
}

// ══════════════════════════════════════════════════════════════
// 场景 A: 模拟 DB 落盘失败 → outbox 重试可恢复
// ══════════════════════════════════════════════════════════════
async function drillA() {
  console.log('=== 场景 A: DB 落盘失败 → outbox 重试恢复 ===\n');

  // 1. 将库存设为 0（模拟 commitStockToDb 将失败 — stock < qty）
  await dbWrite.execute(sql`UPDATE skus SET stock = 0 WHERE id = ${DRILL_SKU}`);

  // 2. 创建一条 outbox 事件
  await createOutboxEvent({
    eventType: 'inventory.decrement.requested',
    aggregateType: 'sku',
    aggregateId: String(DRILL_SKU),
    payload: { skuId: DRILL_SKU, qty: 1, orderId: 1, idempotencyKey: `drill-a-${Date.now()}` },
  });

  // 3. 处理 outbox — 应失败
  const r1 = await processPendingOutboxBatch(10);
  const failedFirstRound = r1.failed > 0;
  record(
    'A1: 库存不足时 outbox 处理失败',
    'failed >= 1',
    `sent=${r1.sent}, failed=${r1.failed}`,
    failedFirstRound
  );

  // 4. 检查事件状态为 failed (status=2)
  const failedRows = (await dbWrite.execute(
    sql`SELECT id, status, retry_count, last_error FROM outbox_events
        WHERE aggregate_id = ${String(DRILL_SKU)} AND status = 2 LIMIT 1`
  )) as unknown as Array<{ id: number; status: number; retry_count: number; last_error: string }>;
  const hasFailed = Array.isArray(failedRows) && failedRows.length > 0;
  record(
    'A2: 事件标记为 failed + 记录错误',
    'status=2, last_error 非空',
    hasFailed ? `status=${failedRows[0]!.status}, error=${failedRows[0]!.last_error?.slice(0, 60)}` : 'no failed event',
    hasFailed
  );

  // 5. 修复库存后重试
  await dbWrite.execute(sql`UPDATE skus SET stock = 100 WHERE id = ${DRILL_SKU}`);
  // 重置事件为 pending 以模拟重试到期
  if (hasFailed) {
    await dbWrite.execute(sql`
      UPDATE outbox_events SET status = 0, next_retry_at = NULL
      WHERE id = ${failedRows[0]!.id}
    `);
  }
  const r2 = await processPendingOutboxBatch(10);
  record(
    'A3: 库存恢复后重试成功',
    'sent >= 1',
    `sent=${r2.sent}, failed=${r2.failed}`,
    r2.sent > 0
  );
}

// ══════════════════════════════════════════════════════════════
// 场景 B: 分区缺失 → maintenance 恢复
// ══════════════════════════════════════════════════════════════
async function drillB() {
  console.log('=== 场景 B: 分区缺失 → maintenance 恢复 ===\n');

  // 1. 尝试创建一个未来月份的分区（模拟缺失 → 创建）
  const futureMonth = '2027-06-01';
  const [result] = (await dbWrite.execute(
    sql`SELECT ensure_payments_month_partition(${futureMonth}::DATE) AS result`
  )) as unknown as Array<{ result: string }>;

  const created = result?.result?.startsWith('created');
  record(
    'B1: 缺失分区自动创建',
    'created: payments_2027_06',
    result?.result ?? 'null',
    created ?? false
  );

  // 2. 再次调用 — 应返回 exists（幂等）
  const [result2] = (await dbWrite.execute(
    sql`SELECT ensure_payments_month_partition(${futureMonth}::DATE) AS result`
  )) as unknown as Array<{ result: string }>;

  const isIdempotent = result2?.result?.startsWith('exists');
  record(
    'B2: 重复调用幂等',
    'exists: payments_2027_06',
    result2?.result ?? 'null',
    isIdempotent ?? false
  );

  // 3. 同样测试 orders_archive
  const [result3] = (await dbWrite.execute(
    sql`SELECT ensure_orders_archive_month_partition(${futureMonth}::DATE) AS result`
  )) as unknown as Array<{ result: string }>;

  record(
    'B3: orders_archive 分区创建',
    'created: orders_archive_2027_06',
    result3?.result ?? 'null',
    result3?.result?.startsWith('created') ?? false
  );

  // 清理测试分区
  await dbWrite.execute(sql`DROP TABLE IF EXISTS payments_2027_06`);
  await dbWrite.execute(sql`DROP TABLE IF EXISTS orders_archive_2027_06`);
}

// ══════════════════════════════════════════════════════════════
// 场景 C: 重复请求 → 幂等键去重
// ══════════════════════════════════════════════════════════════
async function drillC() {
  console.log('=== 场景 C: 重复请求 → 幂等键去重 ===\n');

  const key = `drill-c-idempotent-${Date.now()}`;

  // 1. 首次写入
  const r1 = await appendStockLedger({
    skuId: DRILL_SKU, orderId: 1, delta: -1, reason: 'reserve', idempotencyKey: key,
  });
  record(
    'C1: 首次写入成功',
    'inserted=true',
    `inserted=${r1.inserted}`,
    r1.inserted === true
  );

  // 2. 重复写入 — 同一幂等键
  const r2 = await appendStockLedger({
    skuId: DRILL_SKU, orderId: 1, delta: -1, reason: 'reserve', idempotencyKey: key,
  });
  record(
    'C2: 重复写入被拦截',
    'inserted=false',
    `inserted=${r2.inserted}`,
    r2.inserted === false
  );

  // 3. 检查只有 1 条记录
  const rows = (await dbWrite.execute(
    sql`SELECT count(*)::INT AS cnt FROM stock_ledger WHERE idempotency_key = ${key}`
  )) as unknown as Array<{ cnt: number }>;
  const count = rows[0]?.cnt ?? 0;
  record(
    'C3: 数据库仅 1 条记录',
    'count=1',
    `count=${count}`,
    count === 1
  );

  // 4. 不同幂等键可正常写入
  const key2 = `${key}-v2`;
  const r3 = await appendStockLedger({
    skuId: DRILL_SKU, orderId: 2, delta: -1, reason: 'reserve', idempotencyKey: key2,
  });
  record(
    'C4: 不同幂等键正常写入',
    'inserted=true',
    `inserted=${r3.inserted}`,
    r3.inserted === true
  );
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`[stage3:drill] 开始故障演练 — ${new Date().toISOString()}\n`);

  try {
    await setup();

    await drillA();
    // 重置状态
    await dbWrite.execute(sql`DELETE FROM outbox_events WHERE aggregate_id = ${String(DRILL_SKU)}`);
    await dbWrite.execute(sql`DELETE FROM stock_ledger WHERE sku_id = ${DRILL_SKU}`);
    await dbWrite.execute(sql`UPDATE skus SET stock = 100 WHERE id = ${DRILL_SKU}`);

    await drillB();
    await drillC();

    await cleanup();

    const total = drills.length;
    const passed = drills.filter((d) => d.pass).length;
    const failed = total - passed;

    console.log('══════════════════════════════════════');
    console.log(`  汇总: ${passed}/${total} PASS, ${failed} FAIL`);
    console.log(`  结论: ${failed === 0 ? '✅ 全部演练通过' : '❌ 存在失败项'}`);
    console.log('══════════════════════════════════════\n');

    process.exitCode = failed > 0 ? 1 : 0;
  } finally {
    await closeDbConnections();
  }
}

main();
