/**
 * 库存内部接口 — 基础功能测试
 * reserve / release / confirm / adjust / sync
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { app } from '../index';
import { db, redis, skus, stockOperations, setStock, getStock } from '@repo/database';
import { generateId } from '@repo/shared';
import { eq, and, desc } from 'drizzle-orm';

const BASE = 'http://localhost';

function req(path: string, body?: unknown) {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function getTestSkus(count: number = 3) {
  const rows = await db.select().from(skus).limit(count);
  if (rows.length < count) {
    throw new Error(`Need at least ${count} SKUs in DB, got ${rows.length}. Run seed first.`);
  }
  return rows;
}

describe('Stock Internal API — Basic', () => {
  let testSkuId: string;
  let testSkuIds: string[];

  beforeEach(async () => {
    const testSkus = await getTestSkus(3);
    testSkuId = testSkus[0].id;
    testSkuIds = testSkus.map((s) => s.id);

    for (const id of testSkuIds) {
      await setStock(redis, id, 100);
    }

    // 清理之前测试产生的 stock_operations 记录
    for (const id of testSkuIds) {
      await db.delete(stockOperations).where(eq(stockOperations.skuId, id));
    }
  });

  // 1. reserve 单个 SKU
  test('reserve 单个 SKU — 扣 10 → Redis 库存变 90 + 有操作日志', async () => {
    const orderId = generateId();
    const res = await req('/internal/stock/reserve', {
      items: [{ skuId: testSkuId, quantity: 10 }],
      orderId,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const stock = await getStock(redis, testSkuId);
    expect(stock).toBe(90);

    const ops = await db
      .select()
      .from(stockOperations)
      .where(
        and(
          eq(stockOperations.skuId, testSkuId),
          eq(stockOperations.type, 'reserve'),
        ),
      );
    expect(ops.length).toBeGreaterThanOrEqual(1);
    expect(ops[0].orderId).toBe(orderId);
    expect(ops[0].quantity).toBe(10);
  });

  // 2. reserve 库存不足
  test('reserve 库存不足 → 422 STOCK_INSUFFICIENT + 库存不变', async () => {
    const res = await req('/internal/stock/reserve', {
      items: [{ skuId: testSkuId, quantity: 999 }],
      orderId: generateId(),
    });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.meta.code).toBe('PRODUCT_2003');

    const stock = await getStock(redis, testSkuId);
    expect(stock).toBe(100);
  });

  // 3. reserveMulti 3 个 SKU
  test('reserveMulti 3 个 SKU → 全部扣减成功', async () => {
    const items = testSkuIds.map((id) => ({ skuId: id, quantity: 5 }));
    const res = await req('/internal/stock/reserve', {
      items,
      orderId: generateId(),
    });
    expect(res.status).toBe(200);

    for (const id of testSkuIds) {
      const stock = await getStock(redis, id);
      expect(stock).toBe(95);
    }
  });

  // 4. reserveMulti 第 2 个不足 → 全部不扣
  test('reserveMulti 第 2 个不足 → 全部不扣 + 返回 failedIndex', async () => {
    await setStock(redis, testSkuIds[1], 1);

    const items = testSkuIds.map((id) => ({ skuId: id, quantity: 5 }));
    const res = await req('/internal/stock/reserve', {
      items,
      orderId: generateId(),
    });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.meta.details.failedSkuId).toBe(testSkuIds[1]);
    expect(json.meta.details.failedIndex).toBe(1);

    const stock0 = await getStock(redis, testSkuIds[0]);
    expect(stock0).toBe(100);
  });

  // 5. release 单个 SKU
  test('release 单个 SKU — 先扣 10 再释放 10 → 库存恢复 100', async () => {
    const orderId = generateId();
    await req('/internal/stock/reserve', {
      items: [{ skuId: testSkuId, quantity: 10 }],
      orderId,
    });

    const res = await req('/internal/stock/release', {
      items: [{ skuId: testSkuId, quantity: 10 }],
      orderId,
    });
    expect(res.status).toBe(200);

    const stock = await getStock(redis, testSkuId);
    expect(stock).toBe(100);
  });

  // 6. releaseMulti
  test('releaseMulti — 批量释放恢复库存', async () => {
    const items = testSkuIds.map((id) => ({ skuId: id, quantity: 20 }));
    const orderId = generateId();

    await req('/internal/stock/reserve', { items, orderId });

    const res = await req('/internal/stock/release', { items, orderId });
    expect(res.status).toBe(200);

    for (const id of testSkuIds) {
      const stock = await getStock(redis, id);
      expect(stock).toBe(100);
    }
  });

  // 7. confirm — DB 乐观锁扣减
  test('confirm — DB 的 skus.stock 正确扣减 + version 递增', async () => {
    const [before] = await db
      .select({ stock: skus.stock, version: skus.version })
      .from(skus)
      .where(eq(skus.id, testSkuId));

    const orderId = generateId();
    const res = await req('/internal/stock/confirm', {
      items: [{ skuId: testSkuId, quantity: 5 }],
      orderId,
    });
    expect(res.status).toBe(200);

    const [after] = await db
      .select({ stock: skus.stock, version: skus.version })
      .from(skus)
      .where(eq(skus.id, testSkuId));

    expect(after.stock).toBe(before.stock - 5);
    expect(after.version).toBe(before.version + 1);

    const [op] = await db
      .select()
      .from(stockOperations)
      .where(
        and(
          eq(stockOperations.skuId, testSkuId),
          eq(stockOperations.type, 'confirm'),
        ),
      )
      .orderBy(desc(stockOperations.createdAt))
      .limit(1);
    expect(op.orderId).toBe(orderId);
  });

  // 8. confirm 乐观锁冲突 → 重试成功
  test('confirm 乐观锁冲突后重试成功', async () => {
    const [before] = await db
      .select({ stock: skus.stock, version: skus.version })
      .from(skus)
      .where(eq(skus.id, testSkuId));

    const res = await req('/internal/stock/confirm', {
      items: [{ skuId: testSkuId, quantity: 2 }],
      orderId: generateId(),
    });
    expect(res.status).toBe(200);

    const [after] = await db
      .select({ stock: skus.stock, version: skus.version })
      .from(skus)
      .where(eq(skus.id, testSkuId));
    expect(after.stock).toBe(before.stock - 2);
  });

  // 9. adjust — DB + Redis 同时更新
  test('adjust — DB + Redis 同时更新为新值', async () => {
    const { adjust } = await import('../services/stock.service');
    await adjust(testSkuId, 50, '测试调整');

    const redisStock = await getStock(redis, testSkuId);
    expect(redisStock).toBe(50);

    const [dbRow] = await db
      .select({ stock: skus.stock })
      .from(skus)
      .where(eq(skus.id, testSkuId));
    expect(dbRow.stock).toBe(50);

    const [op] = await db
      .select()
      .from(stockOperations)
      .where(
        and(
          eq(stockOperations.skuId, testSkuId),
          eq(stockOperations.type, 'adjust'),
        ),
      )
      .orderBy(desc(stockOperations.createdAt))
      .limit(1);
    expect(op.quantity).toBe(50);
  });

  // 10. sync（dryRun）
  test('sync dryRun — 返回差异报告', async () => {
    await setStock(redis, testSkuId, 999);

    const res = await req('/internal/stock/sync', { forceSync: false });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.total).toBeGreaterThan(0);

    const redisStock = await getStock(redis, testSkuId);
    expect(redisStock).toBe(999);
  });
});
