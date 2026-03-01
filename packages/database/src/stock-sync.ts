/**
 * Redis ↔ DB 库存对账工具
 * 用于定时任务（Phase 8）和手动运维
 * 以 DB 为最终一致源，Redis 为预扣缓存层
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { skus } from './schema/products';
import { getStock, setStock } from './lua';

export type SyncReport = {
  /** 总 SKU 数 */
  total: number;
  /** 已同步（一致 或 已修复）的数量 */
  synced: number;
  /** 漂移记录：DB 与 Redis 值不一致 */
  drifted: Array<{ skuId: string; dbStock: number; redisStock: number }>;
  /** 在 DB 有但 Redis 缺失的 SKU */
  missing: string[];
};

/**
 * 对比 DB 和 Redis 中的库存，输出差异报告
 * @param database Drizzle DB 实例
 * @param redisClient ioredis 实例
 * @param options.forceSync 以 DB 为准覆盖 Redis（默认 false）
 * @param options.dryRun 只输出报告不写入（默认 true）
 */
export async function syncStockToRedis(
  database: PostgresJsDatabase<any>,
  redisClient: Redis,
  options?: { forceSync?: boolean; dryRun?: boolean },
): Promise<SyncReport> {
  const forceSync = options?.forceSync ?? false;
  const dryRun = options?.dryRun ?? true;

  // 1. 查询所有 active SKU
  const activeSkus = await database
    .select({ id: skus.id, stock: skus.stock })
    .from(skus)
    .where(eq(skus.status, 'active'));

  const report: SyncReport = {
    total: activeSkus.length,
    synced: 0,
    drifted: [],
    missing: [],
  };

  // 2. 逐个对比
  for (const sku of activeSkus) {
    const redisVal = await redisClient.get(`stock:${sku.id}`);

    if (redisVal === null) {
      // Redis 缺失
      report.missing.push(sku.id);
      if (forceSync && !dryRun) {
        await setStock(redisClient, sku.id, sku.stock);
        report.synced++;
      }
      continue;
    }

    const redisStock = parseInt(redisVal, 10);
    if (redisStock !== sku.stock) {
      // 漂移
      report.drifted.push({
        skuId: sku.id,
        dbStock: sku.stock,
        redisStock,
      });
      if (forceSync && !dryRun) {
        await setStock(redisClient, sku.id, sku.stock);
        report.synced++;
      }
    } else {
      report.synced++;
    }
  }

  return report;
}
