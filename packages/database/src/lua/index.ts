/**
 * Redis Lua 库存脚本加载器与调用封装
 * 使用 EVALSHA 执行预加载脚本，保证原子性
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type Redis from 'ioredis';

// ── 读取 Lua 脚本内容 ──
const LUA_DIR = import.meta.dir;

const SCRIPTS = {
  stockDeduct: readFileSync(join(LUA_DIR, 'stock-deduct.lua'), 'utf-8'),
  stockDeductMulti: readFileSync(join(LUA_DIR, 'stock-deduct-multi.lua'), 'utf-8'),
  stockRelease: readFileSync(join(LUA_DIR, 'stock-release.lua'), 'utf-8'),
  stockReleaseMulti: readFileSync(join(LUA_DIR, 'stock-release-multi.lua'), 'utf-8'),
} as const;

// ── SHA1 缓存 ──
const scriptSHAs: Record<keyof typeof SCRIPTS, string> = {} as any;

/**
 * 注册所有 Lua 脚本到 Redis（服务启动时调用一次）
 * 使用 SCRIPT LOAD 预加载，后续通过 EVALSHA 调用
 */
export async function registerLuaScripts(redis: Redis): Promise<void> {
  for (const [name, script] of Object.entries(SCRIPTS)) {
    const sha = await redis.script('LOAD', script) as string;
    scriptSHAs[name as keyof typeof SCRIPTS] = sha;
  }
}

/**
 * 执行已注册的 Lua 脚本
 * 如果 EVALSHA 返回 NOSCRIPT，自动回退到 EVAL
 */
async function execScript(
  redis: Redis,
  name: keyof typeof SCRIPTS,
  keys: string[],
  args: (string | number)[],
): Promise<number> {
  const sha = scriptSHAs[name];
  if (sha) {
    try {
      return await redis.evalsha(sha, keys.length, ...keys, ...args) as number;
    } catch (err: any) {
      if (!err.message?.includes('NOSCRIPT')) throw err;
      // SHA 不存在，回退 EVAL 并重新注册
    }
  }
  const result = await redis.eval(SCRIPTS[name], keys.length, ...keys, ...args) as number;
  // 重新缓存 SHA
  scriptSHAs[name] = await redis.script('LOAD', SCRIPTS[name]) as string;
  return result;
}

// ── Redis Key 格式 ──
function stockKey(skuId: string): string {
  return `stock:${skuId}`;
}

// ── 公开 API ──

/**
 * 单 SKU 库存扣减
 * @returns success=true 扣减成功, code: 1=成功, 0=库存不足, -1=key不存在
 */
export async function deductStock(
  redis: Redis,
  skuId: string,
  quantity: number,
): Promise<{ success: boolean; code: number }> {
  const code = await execScript(redis, 'stockDeduct', [stockKey(skuId)], [quantity]);
  return { success: code === 1, code };
}

/**
 * 多 SKU 原子扣减（一个订单多个商品）
 * 要么全部扣减成功，要么全部不扣减（两阶段检查）
 * @returns success=true 全部成功, failedIndex 为库存不足的 SKU 序号（从1开始）
 */
export async function deductStockMulti(
  redis: Redis,
  items: Array<{ skuId: string; quantity: number }>,
): Promise<{ success: boolean; failedIndex?: number }> {
  const keys = items.map((item) => stockKey(item.skuId));
  const args = items.map((item) => item.quantity);
  const result = await execScript(redis, 'stockDeductMulti', keys, args);
  if (result === 0) return { success: true };
  return { success: false, failedIndex: result };
}

/**
 * 单 SKU 库存释放（订单取消/超时）
 * @returns success=true 释放成功, newStock 为释放后的库存值
 */
export async function releaseStock(
  redis: Redis,
  skuId: string,
  quantity: number,
): Promise<{ success: boolean; newStock: number }> {
  const result = await execScript(redis, 'stockRelease', [stockKey(skuId)], [quantity]);
  if (result === -1) return { success: false, newStock: -1 };
  return { success: true, newStock: result };
}

/**
 * 多 SKU 批量释放
 */
export async function releaseStockMulti(
  redis: Redis,
  items: Array<{ skuId: string; quantity: number }>,
): Promise<{ success: boolean }> {
  const keys = items.map((item) => stockKey(item.skuId));
  const args = items.map((item) => item.quantity);
  await execScript(redis, 'stockReleaseMulti', keys, args);
  return { success: true };
}

/**
 * 查询 SKU 库存（直接 GET，无需 Lua）
 */
export async function getStock(redis: Redis, skuId: string): Promise<number> {
  const val = await redis.get(stockKey(skuId));
  return val === null ? 0 : parseInt(val, 10);
}

/**
 * 设置 SKU 库存（管理端 / 初始化用）
 */
export async function setStock(redis: Redis, skuId: string, quantity: number): Promise<void> {
  await redis.set(stockKey(skuId), quantity);
}
