/**
 * 库存对账脚本 — Redis ↔ DB 同步
 * 以 DB 为最终一致源，修复 Redis 中的漂移
 * 用法: DATABASE_URL=... REDIS_URL=... bun run scripts/stock-sync.ts [--forceSync]
 */
import { db, redis, syncStockToRedis, registerLuaScripts } from '@repo/database';

const forceSync = process.argv.includes('--forceSync');

async function main() {
  console.log('[stock-sync] starting...');
  console.log('[stock-sync] mode:', forceSync ? 'FORCE SYNC (write)' : 'DRY RUN (read only)');

  await redis.connect();
  await registerLuaScripts(redis);

  const report = await syncStockToRedis(db, redis, {
    forceSync,
    dryRun: !forceSync,
  });

  console.log('\n[stock-sync] Report:');
  console.log('  Total SKUs:', report.total);
  console.log('  Synced:', report.synced);
  console.log('  Missing:', report.missing.length);
  console.log('  Drifted:', report.drifted.length);

  if (report.drifted.length > 0) {
    console.log('\n  Drift details:');
    for (const d of report.drifted) {
      console.log(`    ${d.skuId}: DB=${d.dbStock} Redis=${d.redisStock}`);
    }
  }

  if (report.missing.length > 0) {
    console.log('\n  Missing SKUs:', report.missing.join(', '));
  }

  await redis.quit();
  process.exit(0);
}

main().catch((err) => {
  console.error('[stock-sync] failed:', err);
  process.exit(1);
});
