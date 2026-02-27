/**
 * 阶段三验收：结构完整性校验
 * 用法: bun run scripts/db/verify-stage3.ts
 */
import { sql } from 'drizzle-orm';
import { dbWrite, closeDbConnections } from '../../src/db/index.ts';
import { getOrderShardTableName } from '../../src/modules/orders/order-shard.ts';

type Check = { name: string; pass: boolean; detail: string };
const results: Check[] = [];

function record(name: string, pass: boolean, detail = '') {
  results.push({ name, pass, detail });
  const icon = pass ? '✅' : '❌';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function tableExists(name: string): Promise<boolean> {
  const rows = (await dbWrite.execute(
    sql`SELECT 1 FROM pg_class WHERE relname = ${name} AND relkind IN ('r','p')`
  )) as unknown as Array<unknown>;
  return Array.isArray(rows) && rows.length > 0;
}

async function indexExists(name: string): Promise<boolean> {
  // relkind: 'i' = normal index, 'I' = partitioned index
  const rows = (await dbWrite.execute(
    sql`SELECT 1 FROM pg_class WHERE relname = ${name} AND relkind IN ('i','I')`
  )) as unknown as Array<unknown>;
  return Array.isArray(rows) && rows.length > 0;
}

// ──────────────────────────────────────────────────────────────
// 1. 订单分表 orders_00 ~ orders_63
// ──────────────────────────────────────────────────────────────
async function checkOrderShards() {
  console.log('\n=== 1. 订单分表 (orders_00~63) ===');
  let missing = 0;
  for (let i = 0; i < 64; i++) {
    const tbl = `orders_${String(i).padStart(2, '0')}`;
    if (!(await tableExists(tbl))) {
      record(`table ${tbl}`, false, 'NOT FOUND');
      missing++;
    }
  }
  if (missing === 0) {
    record('orders_00~63 全部存在', true, '64/64');
  } else {
    record(`orders 分表缺失`, false, `${missing}/64 missing`);
  }

  // 抽样检查索引（orders_00, orders_31, orders_63）
  for (const i of [0, 31, 63]) {
    const tbl = `orders_${String(i).padStart(2, '0')}`;
    const idxUid = await indexExists(`idx_${tbl}_user_id`);
    const idxCat = await indexExists(`idx_${tbl}_created_at`);
    const idxComp = await indexExists(`idx_${tbl}_uid_cat`);
    record(`${tbl} indexes`, idxUid && idxCat && idxComp,
      `user_id=${idxUid}, created_at=${idxCat}, composite=${idxComp}`);
  }
}

// ──────────────────────────────────────────────────────────────
// 2. 分区覆盖检查
// ──────────────────────────────────────────────────────────────
async function checkPartitions() {
  console.log('\n=== 2. 分区覆盖 (当月+下月) ===');
  const now = new Date();
  const thisM = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextM = `${next.getFullYear()}_${String(next.getMonth() + 1).padStart(2, '0')}`;

  for (const parent of ['payments', 'orders_archive']) {
    for (const month of [thisM, nextM]) {
      const part = `${parent}_${month}`;
      const exists = await tableExists(part);
      record(`${part}`, exists);
    }
    const def = `${parent}_default`;
    record(`${def}`, await tableExists(def));
  }
}

// ──────────────────────────────────────────────────────────────
// 3. 关键索引检查
// ──────────────────────────────────────────────────────────────
async function checkCoreIndexes() {
  console.log('\n=== 3. 关键索引 ===');
  const indexes = [
    'idx_stock_ledger_sku',
    'idx_stock_ledger_order',
    'idx_stock_ledger_cat',
    'uq_stock_ledger_idempotency',
    'idx_outbox_status_retry',
    'idx_outbox_aggregate',
    'idx_outbox_created',
    'uq_archive_jobs_date_table',
    'idx_payments_order',
    'idx_payments_paid_at',
    'idx_skus_product',
  ];
  for (const idx of indexes) {
    const exists = await indexExists(idx);
    record(idx, exists);
  }
}

// ──────────────────────────────────────────────────────────────
// 4. SQL 函数存在性
// ──────────────────────────────────────────────────────────────
async function checkFunctions() {
  console.log('\n=== 4. SQL 函数 ===');
  const fns = [
    'ensure_payments_month_partition',
    'ensure_orders_archive_month_partition',
    'run_orders_archive',
    'cleanup_outbox_events',
  ];
  for (const fn of fns) {
    const rows = (await dbWrite.execute(
      sql`SELECT 1 FROM pg_proc WHERE proname = ${fn}`
    )) as unknown as Array<unknown>;
    record(`function ${fn}`, Array.isArray(rows) && rows.length > 0);
  }
}

// ──────────────────────────────────────────────────────────────
// 5. 分片路由校验
// ──────────────────────────────────────────────────────────────
async function checkShardRouting() {
  console.log('\n=== 5. 分片路由校验 ===');
  const testCases = [
    { userId: 0, expected: 'orders_00' },
    { userId: 1, expected: 'orders_01' },
    { userId: 63, expected: 'orders_63' },
    { userId: 64, expected: 'orders_00' },
    { userId: 12345, expected: `orders_${String(12345 % 64).padStart(2, '0')}` },
    { userId: 9999999, expected: `orders_${String(9999999 % 64).padStart(2, '0')}` },
  ];
  for (const tc of testCases) {
    const actual = getOrderShardTableName(tc.userId);
    record(`userId=${tc.userId}`, actual === tc.expected, `→ ${actual} (expected ${tc.expected})`);
  }
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`[stage3:verify] 开始验收 — ${new Date().toISOString()}\n`);

  try {
    await checkOrderShards();
    await checkPartitions();
    await checkCoreIndexes();
    await checkFunctions();
    await checkShardRouting();

    const total = results.length;
    const passed = results.filter((r) => r.pass).length;
    const failed = total - passed;

    console.log('\n══════════════════════════════════════');
    console.log(`  汇总: ${passed}/${total} PASS, ${failed} FAIL`);
    console.log(`  结论: ${failed === 0 ? '✅ 全部通过' : '❌ 存在失败项'}`);
    console.log('══════════════════════════════════════\n');

    process.exitCode = failed > 0 ? 1 : 0;
  } finally {
    await closeDbConnections();
  }
}

main();
