/**
 * 服务启动初始化工具
 * 缓存预热 + 库存同步 + Lua 脚本注册
 * 供各服务在启动时调用
 */
import { redis, db, registerLuaScripts, syncStockToRedis } from '@repo/database';

export async function initializeService(serviceName: string): Promise<void> {
  console.log(`[INIT] ${serviceName} starting initialization...`);

  // 1. 确保 Redis 连接就绪
  if (redis.status === 'wait') {
    await redis.connect();
  }
  console.log('[INIT] Redis connected');

  // 2. 注册 Lua 脚本（product-service / order-service 需要）
  if (['product-service', 'order-service'].includes(serviceName)) {
    await registerLuaScripts(redis);
    console.log('[INIT] Lua scripts registered');
  }

  // 3. 库存同步（product-service 启动时）
  if (serviceName === 'product-service') {
    try {
      const report = await syncStockToRedis(db, redis, {
        forceSync: true,
        dryRun: false,
      });
      console.log(
        `[INIT] Stock synced: ${report.total} SKUs, ${report.drifted.length} drifted, ${report.missing.length} missing`,
      );
    } catch (err) {
      console.warn('[INIT] Stock sync failed (non-fatal):', (err as Error).message);
    }
  }

  console.log(`[INIT] ${serviceName} ready`);
}
