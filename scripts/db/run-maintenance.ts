/**
 * DB 运维脚本：自动建分区 + 归档 + Outbox 清理
 * 用法: bun run scripts/db/run-maintenance.ts
 */
import { sql } from 'drizzle-orm';
import { dbWrite, closeDbConnections } from '../../src/db/index.ts';

function elapsed(start: number) {
  return `${(performance.now() - start).toFixed(0)}ms`;
}

async function ensurePartitions() {
  const start = performance.now();
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

  console.log('\n=== 分区自动化 ===');

  for (const month of [thisMonthStr, nextMonthStr]) {
    const [pResult] = (await dbWrite.execute(
      sql`SELECT ensure_payments_month_partition(${month}::DATE) AS result`
    )) as unknown as Array<{ result: string }>;
    console.log(`  payments  [${month}]: ${pResult?.result}`);

    const [aResult] = (await dbWrite.execute(
      sql`SELECT ensure_orders_archive_month_partition(${month}::DATE) AS result`
    )) as unknown as Array<{ result: string }>;
    console.log(`  archive   [${month}]: ${aResult?.result}`);
  }

  console.log(`  耗时: ${elapsed(start)}`);
}

async function runArchive() {
  const start = performance.now();
  const today = new Date().toISOString().slice(0, 10);

  console.log('\n=== 归档执行 ===');
  console.log(`  job_day: ${today}`);

  try {
    const rows = (await dbWrite.execute(
      sql`SELECT * FROM run_orders_archive(${today}::DATE)`
    )) as unknown as Array<{ shard: string; moved_rows: string }>;

    if (Array.isArray(rows) && rows.length > 0) {
      let total = 0;
      for (const row of rows) {
        console.log(`  ${row.shard}: ${row.moved_rows} rows moved`);
        total += Number(row.moved_rows);
      }
      console.log(`  total archived: ${total} rows`);
    } else {
      console.log('  无冷数据需归档 (0 rows)');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  归档失败: ${msg}`);
  }

  console.log(`  耗时: ${elapsed(start)}`);
}

async function cleanupOutbox() {
  const start = performance.now();
  const retainDays = 30;

  console.log('\n=== Outbox 清理 ===');

  const [result] = (await dbWrite.execute(
    sql`SELECT cleanup_outbox_events(${retainDays}) AS deleted`
  )) as unknown as Array<{ deleted: string }>;

  console.log(`  保留天数: ${retainDays}`);
  console.log(`  清理条数: ${result?.deleted ?? 0}`);
  console.log(`  耗时: ${elapsed(start)}`);
}

async function main() {
  const totalStart = performance.now();
  console.log(`[ops:maintenance] 开始执行 — ${new Date().toISOString()}`);

  try {
    await ensurePartitions();
    await runArchive();
    await cleanupOutbox();
  } finally {
    console.log(`\n[ops:maintenance] 完成 — 总耗时: ${elapsed(totalStart)}`);
    await closeDbConnections();
  }
}

main();
