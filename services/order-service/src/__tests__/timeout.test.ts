/**
 * 订单超时自动取消测试
 * 通过直接操作 DB 将 expires_at 设为过去时间，然后手动触发 checker
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { app } from '../index';
import { app as userApp } from '../../../user-service/src/index';
import { app as productApp } from '../../../product-service/src/index';
import { app as cartApp } from '../../../cart-service/src/index';
import { db, redis, orders, orderItems, orderAddresses, paymentRecords } from '@repo/database';
import { eq } from 'drizzle-orm';
import { OrderTimeoutChecker } from '../services/timeout.service';

let userServer: ReturnType<typeof Bun.serve>;
let productServer: ReturnType<typeof Bun.serve>;
let cartServer: ReturnType<typeof Bun.serve>;

const BASE = 'http://localhost';
const testEmail = `timeout-test-${Date.now()}@example.com`;

let accessToken = '';
let activeSkuId = '';
let addressId = '';
const orderIdsToClean: string[] = [];

async function cleanupOrder(id: string) {
  await db.delete(paymentRecords).where(eq(paymentRecords.orderId, id));
  await db.delete(orderAddresses).where(eq(orderAddresses.orderId, id));
  await db.delete(orderItems).where(eq(orderItems.orderId, id));
  await db.delete(orders).where(eq(orders.id, id));
}

function req(path: string, body?: unknown, headers?: Record<string, string>) {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
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

function authHeaders(extra?: Record<string, string>) {
  return { Authorization: `Bearer ${accessToken}`, ...extra };
}

describe('Order Timeout Auto-Cancel', () => {
  beforeAll(async () => {
    userServer = Bun.serve({ port: 3001, fetch: userApp.fetch });
    productServer = Bun.serve({ port: 3002, fetch: productApp.fetch });
    cartServer = Bun.serve({ port: 3003, fetch: cartApp.fetch });

    const regRes = await userReq('/api/v1/auth/register', {
      email: testEmail, password: 'password123', nickname: '超时测试',
    });
    accessToken = (await regRes.json()).data.accessToken;

    const addrRes = await userReq('/api/v1/user/address/create', {
      recipient: '王五', phone: '13700137000',
      province: '上海市', city: '上海市', district: '浦东新区',
      address: '张江路 200 号', postalCode: '201203', isDefault: true,
    }, authHeaders());
    addressId = (await addrRes.json()).data.id;

    const listRes = await productReq('/api/v1/product/list', {
      page: 1, pageSize: 5, filters: { status: 'active' },
    });
    const products = (await listRes.json()).data.items;
    for (const p of products) {
      const skuRes = await productReq('/api/v1/product/sku/list', { productId: p.id });
      const skus = (await skuRes.json()).data;
      const activeSku = skus.find((s: any) => s.status === 'active');
      if (activeSku) { activeSkuId = activeSku.id; break; }
    }
  }, 15000);

  afterAll(async () => {
    for (const id of orderIdsToClean) {
      await cleanupOrder(id);
    }
    userServer?.stop();
    productServer?.stop();
    cartServer?.stop();
  });

  test('超时 pending 订单被自动取消', async () => {
    // 1. 创建订单
    const createRes = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuId, quantity: 1 }],
      addressId,
    }, authHeaders({ 'X-Idempotency-Key': `timeout-1-${Date.now()}` }));
    const orderId = (await createRes.json()).data.orderId;
    orderIdsToClean.push(orderId);

    // 2. 将 expires_at 设为过去（模拟超时），同时更新 ZSET score
    const pastTime = new Date(Date.now() - 60_000); // 1分钟前
    await db
      .update(orders)
      .set({ expiresAt: pastTime })
      .where(eq(orders.id, orderId));
    await redis.zadd('order:timeout', pastTime.getTime(), orderId);

    // 3. 手动触发超时检查
    const checker = new OrderTimeoutChecker();
    await checker.check();

    // 4. 验证：订单状态变 cancelled
    const detailRes = await req('/api/v1/order/detail', { orderId }, authHeaders());
    const detail = await detailRes.json();
    expect(detail.data.status).toBe('cancelled');
    expect(detail.data.cancelReason).toBe('支付超时自动取消');
    expect(detail.data.cancelledAt).toBeDefined();

    // 5. 验证：ZSET 已移除
    const score = await redis.zscore('order:timeout', orderId);
    expect(score).toBeNull();
  });

  test('已支付订单到超时时间不被取消', async () => {
    // 1. 创建订单
    const createRes = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuId, quantity: 1 }],
      addressId,
    }, authHeaders({ 'X-Idempotency-Key': `timeout-2-${Date.now()}` }));
    const orderId = (await createRes.json()).data.orderId;
    orderIdsToClean.push(orderId);

    // 2. 模拟支付成功
    await req('/api/v1/payment/notify', {
      orderId,
      transactionId: `tx-timeout-paid-${Date.now()}`,
      status: 'success',
      amount: 100,
      method: 'mock',
    });

    // 3. 手动把该 orderId 放回 ZSET（模拟竞争条件）
    await redis.zadd('order:timeout', Date.now() - 60_000, orderId);

    // 4. 触发超时检查
    const checker = new OrderTimeoutChecker();
    await checker.check();

    // 5. 验证：订单状态仍然是 paid（不被取消）
    const detailRes = await req('/api/v1/order/detail', { orderId }, authHeaders());
    const detail = await detailRes.json();
    expect(detail.data.status).toBe('paid');

    // 6. 验证：ZSET 已清理（非 pending 直接移除）
    const score = await redis.zscore('order:timeout', orderId);
    expect(score).toBeNull();
  });

  test('已被用户取消的订单不重复处理', async () => {
    // 1. 创建并取消订单
    const createRes = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuId, quantity: 1 }],
      addressId,
    }, authHeaders({ 'X-Idempotency-Key': `timeout-3-${Date.now()}` }));
    const orderId = (await createRes.json()).data.orderId;
    orderIdsToClean.push(orderId);

    await req('/api/v1/order/cancel', { orderId, reason: '用户主动取消' }, authHeaders());

    // 2. 手动放回 ZSET
    await redis.zadd('order:timeout', Date.now() - 60_000, orderId);

    // 3. 触发超时检查
    const checker = new OrderTimeoutChecker();
    await checker.check();

    // 4. 验证：cancel_reason 没被覆盖（仍是用户主动取消）
    const detailRes = await req('/api/v1/order/detail', { orderId }, authHeaders());
    const detail = await detailRes.json();
    expect(detail.data.status).toBe('cancelled');
    expect(detail.data.cancelReason).toBe('用户主动取消');
  });
});
