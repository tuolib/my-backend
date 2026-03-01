/**
 * 库存并发安全测试 — 验证零超卖
 * 使用 Promise.allSettled 模拟高并发请求
 */
import { describe, test, expect } from 'bun:test';
import { app } from '../index';
import { db, redis, skus, setStock, getStock } from '@repo/database';
import { generateId } from '@repo/shared';

const BASE = 'http://localhost';

function req(path: string, body: unknown) {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getTestSkus(count: number) {
  const rows = await db.select().from(skus).limit(count);
  if (rows.length < count) {
    throw new Error(`Need at least ${count} SKUs, got ${rows.length}. Run seed first.`);
  }
  return rows;
}

describe('Stock Concurrent Safety', () => {
  // ── 场景 1：单 SKU 并发扣减 ──
  test('200 并发 reserve(1) 对 stock=100 → 恰好 100 成功 + 100 失败 + 最终库存 0', async () => {
    const [sku] = await getTestSkus(1);
    await setStock(redis, sku.id, 100);

    const TOTAL = 200;
    const promises = Array.from({ length: TOTAL }, (_, i) =>
      req('/internal/stock/reserve', {
        items: [{ skuId: sku.id, quantity: 1 }],
        orderId: generateId(),
      }),
    );

    const results = await Promise.allSettled(promises);

    let successCount = 0;
    let failCount = 0;

    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.status === 200) successCount++;
        else failCount++;
      } else {
        failCount++;
      }
    }

    console.log(
      `[CONCURRENT TEST 1] ${TOTAL} requests → ${successCount} success, ${failCount} failed`,
    );

    expect(successCount).toBe(100);
    expect(failCount).toBe(100);

    // 关键验证：Redis 库存 = 0（不是负数）
    const finalStock = await getStock(redis, sku.id);
    expect(finalStock).toBe(0);
    expect(finalStock).toBeGreaterThanOrEqual(0);
  }, 30_000);

  // ── 场景 2：多 SKU 原子性 ──
  test('多 SKU 原子扣减 — 5 并发订单竞争有限库存', async () => {
    const testSkus = await getTestSkus(2);
    const skuA = testSkus[0];
    const skuB = testSkus[1];

    await setStock(redis, skuA.id, 10);
    await setStock(redis, skuB.id, 5);

    // 每个订单需要 SKU-A x 3 + SKU-B x 3
    // SKU-B 只够 1 单（5/3 = 1.67，最多 1 单）
    const ORDERS = 5;
    const promises = Array.from({ length: ORDERS }, () =>
      req('/internal/stock/reserve', {
        items: [
          { skuId: skuA.id, quantity: 3 },
          { skuId: skuB.id, quantity: 3 },
        ],
        orderId: generateId(),
      }),
    );

    const results = await Promise.allSettled(promises);

    let successCount = 0;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.status === 200) successCount++;
    }

    console.log(`[CONCURRENT TEST 2] ${ORDERS} orders → ${successCount} success`);

    expect(successCount).toBeLessThanOrEqual(1);

    const stockA = await getStock(redis, skuA.id);
    const stockB = await getStock(redis, skuB.id);
    expect(stockA).toBeGreaterThanOrEqual(0);
    expect(stockB).toBeGreaterThanOrEqual(0);

    // 验证原子性
    if (successCount === 1) {
      expect(stockA).toBe(7);
      expect(stockB).toBe(2);
    } else {
      expect(stockA).toBe(10);
      expect(stockB).toBe(5);
    }
  }, 15_000);

  // ── 场景 3：reserve + release 并发 ──
  test('并发 reserve + release → 库存一致性', async () => {
    const [sku] = await getTestSkus(1);
    // 初始库存 200，保证 reserve 不会因不足而失败
    await setStock(redis, sku.id, 200);

    const reservePromises = Array.from({ length: 50 }, () =>
      req('/internal/stock/reserve', {
        items: [{ skuId: sku.id, quantity: 2 }],
        orderId: generateId(),
      }),
    );

    const releasePromises = Array.from({ length: 50 }, () =>
      req('/internal/stock/release', {
        items: [{ skuId: sku.id, quantity: 2 }],
        orderId: generateId(),
      }),
    );

    // 交替发送 reserve 和 release
    const allPromises: Promise<Response>[] = [];
    for (let i = 0; i < 50; i++) {
      allPromises.push(reservePromises[i]);
      allPromises.push(releasePromises[i]);
    }

    const results = await Promise.allSettled(allPromises);

    let reserveSuccess = 0;
    let releaseSuccess = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value.status === 200) {
        if (i % 2 === 0) reserveSuccess++;
        else releaseSuccess++;
      }
    }

    console.log(
      `[CONCURRENT TEST 3] reserve: ${reserveSuccess}/50, release: ${releaseSuccess}/50`,
    );

    expect(releaseSuccess).toBe(50);

    // 最终库存 = 200 - reserveSuccess*2 + 50*2
    const finalStock = await getStock(redis, sku.id);
    const expected = 200 - reserveSuccess * 2 + 50 * 2;
    expect(finalStock).toBe(expected);
    expect(finalStock).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
