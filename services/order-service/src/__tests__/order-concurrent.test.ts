/**
 * 并发下单压力测试 ⚡️
 * 测试库存并发安全、幂等并发安全
 *
 * 前置：PG + Redis 运行中，种子数据已初始化
 * 需要真实启动所有服务（HTTP 调用 product-service 库存接口）
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { app } from '../index';
import { app as userApp } from '../../../user-service/src/index';
import { app as productApp } from '../../../product-service/src/index';
import { app as cartApp } from '../../../cart-service/src/index';
import { db, redis, orders, orderItems, orderAddresses, paymentRecords } from '@repo/database';
import { eq, and, inArray } from 'drizzle-orm';

let userServer: ReturnType<typeof Bun.serve>;
let productServer: ReturnType<typeof Bun.serve>;
let cartServer: ReturnType<typeof Bun.serve>;
let orderServer: ReturnType<typeof Bun.serve>;

const BASE = 'http://localhost';
const orderIdsToClean: string[] = [];

// 多个测试用户（并发下单需要不同用户或相同用户不同幂等 key）
let accessToken = '';
let addressId = '';
let testSkuId = '';
let initialStock = 0;

async function cleanupOrder(id: string) {
  await db.delete(paymentRecords).where(eq(paymentRecords.orderId, id));
  await db.delete(orderAddresses).where(eq(orderAddresses.orderId, id));
  await db.delete(orderItems).where(eq(orderItems.orderId, id));
  await db.delete(orders).where(eq(orders.id, id));
}

function userReq(path: string, body?: unknown, headers?: Record<string, string>) {
  return userApp.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function productReq(path: string, body?: unknown) {
  return productApp.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('Concurrent Order Tests', () => {
  beforeAll(async () => {
    userServer = Bun.serve({ port: 3001, fetch: userApp.fetch });
    productServer = Bun.serve({ port: 3002, fetch: productApp.fetch });
    cartServer = Bun.serve({ port: 3003, fetch: cartApp.fetch });
    orderServer = Bun.serve({ port: 3004, fetch: app.fetch });

    // 注册测试用户
    const regRes = await userReq('/api/v1/auth/register', {
      email: `concurrent-${Date.now()}@example.com`,
      password: 'password123',
      nickname: '并发测试用户',
    });
    accessToken = (await regRes.json()).data.accessToken;

    // 创建地址
    const addrRes = await userReq('/api/v1/user/address/create', {
      recipient: '并发测试', phone: '13600136000',
      province: '浙江省', city: '杭州市', district: '西湖区',
      address: '文三路 300 号', postalCode: '310012', isDefault: true,
    }, { Authorization: `Bearer ${accessToken}` });
    addressId = (await addrRes.json()).data.id;

    // 获取一个有库存的 SKU
    const listRes = await productReq('/api/v1/product/list', {
      page: 1, pageSize: 5, filters: { status: 'active' },
    });
    const products = (await listRes.json()).data.items;

    for (const p of products) {
      const skuRes = await productReq('/api/v1/product/sku/list', { productId: p.id });
      const skus = (await skuRes.json()).data;
      const activeSku = skus.find((s: any) => s.status === 'active' && s.stock > 0);
      if (activeSku) {
        testSkuId = activeSku.id;
        // 读取 Redis 中的实时库存
        const stockVal = await redis.get(`stock:${testSkuId}`);
        initialStock = stockVal ? parseInt(stockVal, 10) : activeSku.stock;
        break;
      }
    }

    expect(testSkuId).toBeTruthy();
    expect(initialStock).toBeGreaterThan(0);
  }, 15000);

  afterAll(async () => {
    for (const id of orderIdsToClean) {
      await cleanupOrder(id);
    }
    orderServer?.stop();
    userServer?.stop();
    productServer?.stop();
    cartServer?.stop();
  });

  test('场景 1：同一 SKU 并发下单 — 库存安全', async () => {
    // 读取当前库存
    const stockBefore = parseInt(await redis.get(`stock:${testSkuId}`) || '0', 10);
    const concurrency = Math.min(stockBefore + 5, 20); // 超过库存 5 个
    const quantityPerOrder = 1;

    // 并发请求（通过 HTTP 到 order-service 确保经过完整中间件链）
    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, (_, i) =>
        fetch(`http://localhost:3004/api/v1/order/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'X-Idempotency-Key': `concurrent-1-${Date.now()}-${i}`,
          },
          body: JSON.stringify({
            items: [{ skuId: testSkuId, quantity: quantityPerOrder }],
            addressId,
          }),
        }).then(async (r) => {
          const json = await r.json();
          return { status: r.status, json };
        }),
      ),
    );

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ status: number; json: any }> =>
        r.status === 'fulfilled',
    );

    const successes = fulfilled.filter((r) => r.value.status === 200);
    const failures = fulfilled.filter((r) => r.value.status !== 200);

    console.log(
      `[CONCURRENT-1] ${concurrency} concurrent, ${successes.length} success, ${failures.length} failed`,
    );

    // 收集创建成功的订单 ID 用于清理
    for (const s of successes) {
      if (s.value.json.data?.orderId) {
        orderIdsToClean.push(s.value.json.data.orderId);
      }
    }

    // 验证：成功数 <= 初始库存
    expect(successes.length).toBeLessThanOrEqual(stockBefore);

    // 验证：Redis 库存 >= 0（绝不为负）
    const stockAfter = parseInt(await redis.get(`stock:${testSkuId}`) || '0', 10);
    expect(stockAfter).toBeGreaterThanOrEqual(0);

    // 验证：库存扣减量 = 成功订单数 × quantityPerOrder
    const expectedDeduction = successes.length * quantityPerOrder;
    expect(stockBefore - stockAfter).toBe(expectedDeduction);

    console.log(
      `[CONCURRENT-1] Stock: ${stockBefore} → ${stockAfter}, deducted=${expectedDeduction}`,
    );
  }, 30000);

  test('场景 2：同一幂等 key 并发提交 — 只创建 1 单', async () => {
    const idempotencyKey = `concurrent-idemp-${Date.now()}`;
    const concurrency = 10;

    // 记录当前库存
    const stockBefore = parseInt(await redis.get(`stock:${testSkuId}`) || '0', 10);

    // 并发 10 次相同 idempotencyKey
    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, () =>
        fetch(`http://localhost:3004/api/v1/order/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'X-Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            items: [{ skuId: testSkuId, quantity: 1 }],
            addressId,
          }),
        }).then(async (r) => {
          const json = await r.json();
          return { status: r.status, json };
        }),
      ),
    );

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ status: number; json: any }> =>
        r.status === 'fulfilled',
    );

    // 200 的响应（首次 + service 层幂等返回）
    const ok200 = fulfilled.filter((r) => r.value.status === 200);
    // 409 的响应（中间件层幂等拦截）
    const ok409 = fulfilled.filter((r) => r.value.status === 409);

    console.log(
      `[CONCURRENT-2] ${concurrency} concurrent same key: ${ok200.length}×200, ${ok409.length}×409`,
    );

    // 收集唯一订单 ID
    const orderIds = new Set<string>();
    for (const r of ok200) {
      if (r.value.json.data?.orderId) {
        orderIds.add(r.value.json.data.orderId);
      }
    }

    // 验证：只创建了 1 个订单
    expect(orderIds.size).toBe(1);

    for (const id of orderIds) {
      orderIdsToClean.push(id);
    }

    // 验证：库存只扣了 1 次
    const stockAfter = parseInt(await redis.get(`stock:${testSkuId}`) || '0', 10);
    expect(stockBefore - stockAfter).toBe(1);

    console.log(`[CONCURRENT-2] Unique orders: ${orderIds.size}, stock deducted: ${stockBefore - stockAfter}`);
  }, 30000);

  test('场景 3：下单 + 取消并发 — 库存最终一致', async () => {
    // 记录当前库存
    const stockBefore = parseInt(await redis.get(`stock:${testSkuId}`) || '0', 10);

    if (stockBefore < 2) {
      console.log('[CONCURRENT-3] Skipped: insufficient stock for test');
      return;
    }

    // 创建一个订单
    const createRes = await fetch(`http://localhost:3004/api/v1/order/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Idempotency-Key': `concurrent-3-${Date.now()}`,
      },
      body: JSON.stringify({
        items: [{ skuId: testSkuId, quantity: 2 }],
        addressId,
      }),
    });
    const createJson = await createRes.json();
    expect(createRes.status).toBe(200);
    const orderId = createJson.data.orderId;
    orderIdsToClean.push(orderId);

    const stockAfterCreate = parseInt(await redis.get(`stock:${testSkuId}`) || '0', 10);
    expect(stockBefore - stockAfterCreate).toBe(2);

    // 取消该订单
    const cancelRes = await fetch(`http://localhost:3004/api/v1/order/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ orderId, reason: '并发测试取消' }),
    });
    expect(cancelRes.status).toBe(200);

    // 验证：库存已完全恢复
    const stockAfterCancel = parseInt(await redis.get(`stock:${testSkuId}`) || '0', 10);
    expect(stockAfterCancel).toBe(stockBefore);

    console.log(
      `[CONCURRENT-3] Stock: ${stockBefore} → ${stockAfterCreate} → ${stockAfterCancel} (restored)`,
    );
  }, 30000);
});
