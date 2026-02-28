/**
 * 端到端全流程测试
 * 完整购买流程：注册 → 浏览 → 加购 → 下单 → 支付 → 发货 → 数据一致性验证
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
const testEmail = `fullflow-${Date.now()}@example.com`;

let accessToken = '';
let userId = '';
let skuId = '';
let skuPrice = '';
let addressId = '';
let orderId = '';
let orderNo = '';
let payAmount = '';

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

function cartReq(path: string, body?: unknown, headers?: Record<string, string>) {
  return cartApp.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function authHeaders(extra?: Record<string, string>) {
  return { Authorization: `Bearer ${accessToken}`, ...extra };
}

describe('Full Purchase Flow (E2E)', () => {
  beforeAll(async () => {
    userServer = Bun.serve({ port: 3001, fetch: userApp.fetch });
    productServer = Bun.serve({ port: 3002, fetch: productApp.fetch });
    cartServer = Bun.serve({ port: 3003, fetch: cartApp.fetch });
  }, 10000);

  afterAll(async () => {
    if (orderId) await cleanupOrder(orderId);
    userServer?.stop();
    productServer?.stop();
    cartServer?.stop();
  });

  // ── Step 1: 用户注册 ──
  test('1. 注册 + 登录获取 token', async () => {
    const res = await userReq('/api/v1/auth/register', {
      email: testEmail, password: 'password123', nickname: '全流程测试',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    accessToken = json.data.accessToken;
    expect(accessToken).toBeTruthy();

    // 获取 userId
    const profileRes = await userReq('/api/v1/user/profile', undefined, authHeaders());
    userId = (await profileRes.json()).data.id;
    expect(userId).toBeTruthy();
  });

  // ── Step 2: 创建收货地址 ──
  test('2. 创建收货地址', async () => {
    const res = await userReq('/api/v1/user/address/create', {
      recipient: '全流程', phone: '13500135000',
      province: '广东省', city: '广州市', district: '天河区',
      address: '天河路 100 号', postalCode: '510620', isDefault: true,
    }, authHeaders());
    expect(res.status).toBe(200);
    addressId = (await res.json()).data.id;
    expect(addressId).toBeTruthy();
  });

  // ── Step 3: 浏览商品获取 SKU ──
  test('3. 浏览商品列表 + 获取 SKU', async () => {
    const listRes = await productReq('/api/v1/product/list', {
      page: 1, pageSize: 5, filters: { status: 'active' },
    });
    expect(listRes.status).toBe(200);
    const products = (await listRes.json()).data.items;
    expect(products.length).toBeGreaterThan(0);

    // 获取第一个商品的活跃 SKU
    for (const p of products) {
      const skuRes = await productReq('/api/v1/product/sku/list', { productId: p.id });
      const skus = (await skuRes.json()).data;
      const activeSku = skus.find((s: any) => s.status === 'active' && s.stock > 0);
      if (activeSku) {
        skuId = activeSku.id;
        skuPrice = activeSku.price;
        break;
      }
    }
    expect(skuId).toBeTruthy();
    expect(parseFloat(skuPrice)).toBeGreaterThan(0);
  });

  // ── Step 4: 加入购物车 ──
  test('4. 加入购物车', async () => {
    const res = await cartReq('/api/v1/cart/add', {
      skuId, quantity: 2,
    }, authHeaders());
    expect(res.status).toBe(200);

    // 验证购物车
    const listRes = await cartReq('/api/v1/cart/list', undefined, authHeaders());
    const items = (await listRes.json()).data;
    const cartItem = items.find((i: any) => i.skuId === skuId);
    expect(cartItem).toBeDefined();
    expect(cartItem.quantity).toBe(2);
  });

  // ── Step 5: 创建订单 ──
  test('5. 创建订单（库存扣减 + 购物车清理）', async () => {
    const stockBefore = parseInt(await redis.get(`stock:${skuId}`) || '0', 10);

    const res = await req('/api/v1/order/create', {
      items: [{ skuId, quantity: 2 }],
      addressId,
      remark: '全流程测试订单',
    }, authHeaders({ 'X-Idempotency-Key': `fullflow-${Date.now()}` }));
    expect(res.status).toBe(200);
    const json = await res.json();

    orderId = json.data.orderId;
    orderNo = json.data.orderNo;
    payAmount = json.data.payAmount;

    // 验证：金额 = SKU 价格 × 2
    const expectedPay = (parseFloat(skuPrice) * 2).toFixed(2);
    expect(payAmount).toBe(expectedPay);

    // 验证：Redis 库存已扣减
    const stockAfter = parseInt(await redis.get(`stock:${skuId}`) || '0', 10);
    expect(stockBefore - stockAfter).toBe(2);

    // 验证：购物车已清理
    const cartRes = await cartReq('/api/v1/cart/list', undefined, authHeaders());
    const cartItems = (await cartRes.json()).data;
    const removed = cartItems.find((i: any) => i.skuId === skuId);
    expect(removed).toBeUndefined();
  });

  // ── Step 6: 发起支付 ──
  test('6. 发起支付', async () => {
    const res = await req('/api/v1/payment/create', {
      orderId, method: 'mock',
    }, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.paymentId).toBeDefined();
    expect(json.data.payUrl).toContain('mock://pay/');
    expect(json.data.amount).toBe(payAmount);
  });

  // ── Step 7: 模拟支付回调 ──
  test('7. 支付回调 → 订单变 paid + stock confirm', async () => {
    const transactionId = `tx-fullflow-${Date.now()}`;
    const res = await req('/api/v1/payment/notify', {
      orderId,
      transactionId,
      status: 'success',
      amount: parseFloat(payAmount),
      method: 'mock',
    });
    expect(res.status).toBe(200);

    // 验证订单状态
    const detailRes = await req('/api/v1/order/detail', { orderId }, authHeaders());
    const detail = await detailRes.json();
    expect(detail.data.status).toBe('paid');
    expect(detail.data.paidAt).toBeDefined();

    // 验证支付记录
    const payRes = await req('/api/v1/payment/query', { orderId }, authHeaders());
    const payJson = await payRes.json();
    expect(payJson.data.payments.length).toBeGreaterThanOrEqual(1);
    const successPay = payJson.data.payments.find((p: any) => p.status === 'success');
    expect(successPay).toBeDefined();
    expect(successPay.transactionId).toBe(transactionId);

    // 验证超时 ZSET 已移除
    const score = await redis.zscore('order:timeout', orderId);
    expect(score).toBeNull();
  });

  // ── Step 8: 管理员发货 ──
  test('8. 管理员发货 → shipped', async () => {
    const res = await req('/api/v1/admin/order/ship', {
      orderId, trackingNo: 'SF1234567890',
    }, authHeaders());
    expect(res.status).toBe(200);

    const detailRes = await req('/api/v1/order/detail', { orderId }, authHeaders());
    const detail = await detailRes.json();
    expect(detail.data.status).toBe('shipped');
    expect(detail.data.shippedAt).toBeDefined();
  });

  // ── 验证数据一致性 ──
  test('9. 数据一致性验证', async () => {
    // 查 DB 直接验证
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order).toBeDefined();
    expect(order.status).toBe('shipped');
    expect(order.payAmount).toBe(payAmount);
    expect(order.orderNo).toBe(orderNo);
    expect(order.userId).toBe(userId);
    expect(order.version).toBeGreaterThan(0); // 经过多次状态更新

    // 检查 order_items
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    expect(items.length).toBe(1);
    expect(items[0].skuId).toBe(skuId);
    expect(items[0].quantity).toBe(2);
    expect(items[0].unitPrice).toBe(skuPrice);
    expect(items[0].subtotal).toBe((parseFloat(skuPrice) * 2).toFixed(2));

    // 检查 order_addresses
    const [addr] = await db.select().from(orderAddresses).where(eq(orderAddresses.orderId, orderId));
    expect(addr).toBeDefined();
    expect(addr.recipient).toBe('全流程');

    // 检查 payment_records
    const payments = await db.select().from(paymentRecords).where(eq(paymentRecords.orderId, orderId));
    expect(payments.length).toBeGreaterThanOrEqual(1);
    const successRecord = payments.find((p) => p.status === 'success');
    expect(successRecord).toBeDefined();
  });
});
