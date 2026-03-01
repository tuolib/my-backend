/**
 * 支付 API 集成测试
 * 测试支付发起、回调幂等、查询支付状态
 *
 * 前置：PG + Redis 运行中，种子数据已初始化
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { app } from '../index';
import { app as userApp } from '../../../user-service/src/index';
import { app as productApp } from '../../../product-service/src/index';
import { app as cartApp } from '../../../cart-service/src/index';
import { db, redis, orders, orderItems, orderAddresses, paymentRecords } from '@repo/database';
import { eq } from 'drizzle-orm';

let userServer: ReturnType<typeof Bun.serve>;
let productServer: ReturnType<typeof Bun.serve>;
let cartServer: ReturnType<typeof Bun.serve>;

const BASE = 'http://localhost';
const testEmail = `payment-test-${Date.now()}@example.com`;
const testPassword = 'password123';

let accessToken = '';
let activeSkuId = '';
let addressId = '';
let orderId = '';

/** 清理订单及关联数据 */
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

const orderIdsToClean: string[] = [];

describe('Payment API', () => {
  beforeAll(async () => {
    userServer = Bun.serve({ port: 3001, fetch: userApp.fetch });
    productServer = Bun.serve({ port: 3002, fetch: productApp.fetch });
    cartServer = Bun.serve({ port: 3003, fetch: cartApp.fetch });

    // 注册 + 地址
    const regRes = await userReq('/api/v1/auth/register', {
      email: testEmail, password: testPassword, nickname: '支付测试用户',
    });
    accessToken = (await regRes.json()).data.accessToken;

    const addrRes = await userReq('/api/v1/user/address/create', {
      recipient: '李四', phone: '13900139000',
      province: '北京市', city: '北京市', district: '海淀区',
      address: '中关村大街 1 号', postalCode: '100080', isDefault: true,
    }, authHeaders());
    addressId = (await addrRes.json()).data.id;

    // 获取 SKU
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

    // 创建一个 pending 订单
    const orderRes = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuId, quantity: 1 }],
      addressId,
    }, authHeaders({ 'X-Idempotency-Key': `pay-test-${Date.now()}` }));
    const orderJson = await orderRes.json();
    orderId = orderJson.data.orderId;
    orderIdsToClean.push(orderId);
  }, 15000);

  afterAll(async () => {
    for (const id of orderIdsToClean) {
      await cleanupOrder(id);
    }
    userServer?.stop();
    productServer?.stop();
    cartServer?.stop();
  });

  // ═══════════ 发起支付 ═══════════

  test('POST /api/v1/payment/create — 成功发起支付', async () => {
    const res = await req('/api/v1/payment/create', {
      orderId, method: 'mock',
    }, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.paymentId).toBeDefined();
    expect(json.data.method).toBe('mock');
    expect(json.data.payUrl).toContain('mock://pay/');
    expect(parseFloat(json.data.amount)).toBeGreaterThan(0);
  });

  test('POST /api/v1/payment/create — 不存在的订单 → 404', async () => {
    const res = await req('/api/v1/payment/create', {
      orderId: 'nonexistent-id-xxxxxx', method: 'mock',
    }, authHeaders());
    expect(res.status).toBe(404);
  });

  // ═══════════ 支付回调 ═══════════

  test('POST /api/v1/payment/notify — 支付成功回调', async () => {
    const transactionId = `tx-success-${Date.now()}`;
    const res = await req('/api/v1/payment/notify', {
      orderId,
      transactionId,
      status: 'success',
      amount: 100,
      method: 'mock',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.success).toBe(true);

    // 验证订单状态变为 paid
    const detailRes = await req('/api/v1/order/detail', { orderId }, authHeaders());
    const detail = await detailRes.json();
    expect(detail.data.status).toBe('paid');
    expect(detail.data.paidAt).toBeDefined();

    // 验证 Redis 超时 ZSET 已移除
    const score = await redis.zscore('order:timeout', orderId);
    expect(score).toBeNull();
  });

  test('POST /api/v1/payment/notify — 同一 transactionId 再次回调（幂等）', async () => {
    const transactionId = `tx-success-${Date.now() - 1000}`;

    // 先创建一个新订单来测试幂等
    const newOrderRes = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuId, quantity: 1 }],
      addressId,
    }, authHeaders({ 'X-Idempotency-Key': `pay-idemp-${Date.now()}` }));
    const newOrderId = (await newOrderRes.json()).data.orderId;
    orderIdsToClean.push(newOrderId);

    // 第一次回调
    await req('/api/v1/payment/notify', {
      orderId: newOrderId, transactionId, status: 'success', amount: 100, method: 'mock',
    });

    // 第二次相同 transactionId
    const res2 = await req('/api/v1/payment/notify', {
      orderId: newOrderId, transactionId, status: 'success', amount: 100, method: 'mock',
    });
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.data.success).toBe(true);
  });

  test('POST /api/v1/payment/notify — 支付失败回调', async () => {
    // 创建新订单
    const newOrderRes = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuId, quantity: 1 }],
      addressId,
    }, authHeaders({ 'X-Idempotency-Key': `pay-fail-${Date.now()}` }));
    const newOrderId = (await newOrderRes.json()).data.orderId;
    orderIdsToClean.push(newOrderId);

    const res = await req('/api/v1/payment/notify', {
      orderId: newOrderId,
      transactionId: `tx-fail-${Date.now()}`,
      status: 'failed',
      amount: 100,
      method: 'mock',
    });
    expect(res.status).toBe(200);

    // 订单状态应该仍然是 pending（支付失败不改订单状态）
    const detailRes = await req('/api/v1/order/detail', { orderId: newOrderId }, authHeaders());
    const detail = await detailRes.json();
    expect(detail.data.status).toBe('pending');
  });

  // ═══════════ 支付状态查询 ═══════════

  test('POST /api/v1/payment/query — 查询已支付订单的支付记录', async () => {
    const res = await req('/api/v1/payment/query', { orderId }, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.orderId).toBe(orderId);
    expect(json.data.orderStatus).toBe('paid');
    expect(json.data.payments.length).toBeGreaterThanOrEqual(1);

    const successPayment = json.data.payments.find((p: any) => p.status === 'success');
    expect(successPayment).toBeDefined();
    expect(successPayment.transactionId).toBeDefined();
  });

  test('POST /api/v1/payment/query — 查询不存在的订单 → 404', async () => {
    const res = await req('/api/v1/payment/query', { orderId: 'nonexistent-xxx' }, authHeaders());
    expect(res.status).toBe(404);
  });

  // ═══════════ 状态限制 ═══════════

  test('POST /api/v1/payment/create — 已支付订单不能再支付 → 422', async () => {
    const res = await req('/api/v1/payment/create', { orderId, method: 'mock' }, authHeaders());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.meta.code).toBe('ORDER_4004');
  });

  // ═══════════ 管理员发货（paid → shipped）═══════════

  test('POST /api/v1/admin/order/ship — paid 订单发货成功', async () => {
    const res = await req('/api/v1/admin/order/ship', { orderId }, authHeaders());
    expect(res.status).toBe(200);

    const detailRes = await req('/api/v1/order/detail', { orderId }, authHeaders());
    const detail = await detailRes.json();
    expect(detail.data.status).toBe('shipped');
    expect(detail.data.shippedAt).toBeDefined();
  });
});
