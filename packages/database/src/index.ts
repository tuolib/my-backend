/**
 * @repo/database 统一导出
 * 连接层 + Schema + 迁移
 * Lua 脚本和 seed 在下一步添加
 */

// ── Client ──
export { db, connection } from './client';

// ── Redis ──
export { redis, createRedis } from './redis';

// ── Migration ──
export { migrate } from './migrate';

// ── Schema ──
export * from './schema';
