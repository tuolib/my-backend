/**
 * Lua 库存脚本集成测试
 * 需要真实 Redis 运行（docker compose up -d）
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import Redis from 'ioredis';
import {
  registerLuaScripts,
  deductStock,
  deductStockMulti,
  releaseStock,
  releaseStockMulti,
  getStock,
  setStock,
} from './index';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });

// 测试用 SKU ID（带前缀避免冲突）
const TEST_SKU_1 = 'test-sku-001';
const TEST_SKU_2 = 'test-sku-002';
const TEST_SKU_3 = 'test-sku-003';
const TEST_KEYS = [TEST_SKU_1, TEST_SKU_2, TEST_SKU_3].map((id) => `stock:${id}`);

beforeEach(async () => {
  await redis.connect().catch(() => {});
  // 清理测试 key
  for (const key of TEST_KEYS) {
    await redis.del(key);
  }
});

afterAll(async () => {
  // 清理测试 key
  for (const key of TEST_KEYS) {
    await redis.del(key);
  }
  await redis.quit();
});

describe('registerLuaScripts', () => {
  test('should register all scripts without error', async () => {
    await expect(registerLuaScripts(redis)).resolves.toBeUndefined();
  });
});

describe('setStock / getStock', () => {
  test('should set and get stock value', async () => {
    await setStock(redis, TEST_SKU_1, 100);
    const stock = await getStock(redis, TEST_SKU_1);
    expect(stock).toBe(100);
  });

  test('should return 0 for non-existent key', async () => {
    const stock = await getStock(redis, 'non-existent-sku');
    expect(stock).toBe(0);
  });
});

describe('deductStock', () => {
  test('should deduct stock successfully', async () => {
    await setStock(redis, TEST_SKU_1, 100);
    const result = await deductStock(redis, TEST_SKU_1, 10);
    expect(result).toEqual({ success: true, code: 1 });

    const remaining = await getStock(redis, TEST_SKU_1);
    expect(remaining).toBe(90);
  });

  test('should fail when stock insufficient', async () => {
    await setStock(redis, TEST_SKU_1, 5);
    const result = await deductStock(redis, TEST_SKU_1, 10);
    expect(result).toEqual({ success: false, code: 0 });

    // 库存不变
    const remaining = await getStock(redis, TEST_SKU_1);
    expect(remaining).toBe(5);
  });

  test('should return code -1 when key does not exist', async () => {
    await redis.del(`stock:${TEST_SKU_1}`);
    const result = await deductStock(redis, TEST_SKU_1, 1);
    expect(result).toEqual({ success: false, code: -1 });
  });
});

describe('deductStockMulti', () => {
  test('should deduct all SKUs when all have sufficient stock', async () => {
    await setStock(redis, TEST_SKU_1, 100);
    await setStock(redis, TEST_SKU_2, 100);
    await setStock(redis, TEST_SKU_3, 100);

    const result = await deductStockMulti(redis, [
      { skuId: TEST_SKU_1, quantity: 10 },
      { skuId: TEST_SKU_2, quantity: 20 },
      { skuId: TEST_SKU_3, quantity: 30 },
    ]);
    expect(result).toEqual({ success: true });

    expect(await getStock(redis, TEST_SKU_1)).toBe(90);
    expect(await getStock(redis, TEST_SKU_2)).toBe(80);
    expect(await getStock(redis, TEST_SKU_3)).toBe(70);
  });

  test('should not deduct any SKU when one has insufficient stock (atomicity)', async () => {
    await setStock(redis, TEST_SKU_1, 100);
    await setStock(redis, TEST_SKU_2, 5); // 不足
    await setStock(redis, TEST_SKU_3, 100);

    const result = await deductStockMulti(redis, [
      { skuId: TEST_SKU_1, quantity: 10 },
      { skuId: TEST_SKU_2, quantity: 10 }, // 第 2 个不足
      { skuId: TEST_SKU_3, quantity: 10 },
    ]);
    expect(result).toEqual({ success: false, failedIndex: 2 });

    // 原子性：所有库存不变
    expect(await getStock(redis, TEST_SKU_1)).toBe(100);
    expect(await getStock(redis, TEST_SKU_2)).toBe(5);
    expect(await getStock(redis, TEST_SKU_3)).toBe(100);
  });
});

describe('releaseStock', () => {
  test('should release stock and return new value', async () => {
    await setStock(redis, TEST_SKU_1, 90);
    const result = await releaseStock(redis, TEST_SKU_1, 10);
    expect(result).toEqual({ success: true, newStock: 100 });

    const stock = await getStock(redis, TEST_SKU_1);
    expect(stock).toBe(100);
  });

  test('should return -1 when key does not exist', async () => {
    await redis.del(`stock:${TEST_SKU_1}`);
    const result = await releaseStock(redis, TEST_SKU_1, 10);
    expect(result).toEqual({ success: false, newStock: -1 });
  });
});

describe('releaseStockMulti', () => {
  test('should release all SKUs', async () => {
    await setStock(redis, TEST_SKU_1, 90);
    await setStock(redis, TEST_SKU_2, 80);
    await setStock(redis, TEST_SKU_3, 70);

    const result = await releaseStockMulti(redis, [
      { skuId: TEST_SKU_1, quantity: 10 },
      { skuId: TEST_SKU_2, quantity: 20 },
      { skuId: TEST_SKU_3, quantity: 30 },
    ]);
    expect(result).toEqual({ success: true });

    expect(await getStock(redis, TEST_SKU_1)).toBe(100);
    expect(await getStock(redis, TEST_SKU_2)).toBe(100);
    expect(await getStock(redis, TEST_SKU_3)).toBe(100);
  });
});
