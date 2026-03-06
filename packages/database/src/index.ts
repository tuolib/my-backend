/**
 * @repo/database 统一导出
 * 连接层 + Schema + 迁移 + Lua 脚本 + 库存同步
 */

// ── Client ──
export { db, connection, warmupDb } from './client';

// ── Redis ──
export { redis, createRedis, warmupRedis } from './redis';

// ── Migration ──
export { migrate } from './migrate';

// ── Schema ──
export * from './schema';

// ── Lua 库存脚本 ──
export {
  registerLuaScripts,
  deductStock,
  deductStockMulti,
  releaseStock,
  releaseStockMulti,
  getStock,
  setStock,
} from './lua';

// ── 库存同步 ──
export { syncStockToRedis } from './stock-sync';
export type { SyncReport } from './stock-sync';
