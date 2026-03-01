/**
 * 订单 API 集成测试
 * 测试创建/幂等/列表/详情/取消/管理端操作
 *
 * 前置：PG + Redis 运行中，种子数据已初始化
 * 启动 user-service / product-service / cart-service 作为依赖
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { app } from '../index';
import { app as userApp } from '../../../user-service/src/index';
import { app as productApp } from '../../../product-service/src/index';
import { app as cartApp } from '../../../cart-service/src/index';
import { db, redis, orders, orderItems, orderAddresses } from '@repo/database';
import { eq } from 'drizzle-orm';

/** 清理订单及其关联数据（处理 FK 约束） */
async function cleanupOrder(orderId: string) {
  await db.delete(orderAddresses).where(eq(orderAddresses.orderId, orderId));
  await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
  await db.delete(orders).where(eq(orders.id, orderId));
}

// ── 启动依赖服务（order-service 的 HTTP clients 需要连接真实端口） ──
let userServer: ReturnType<typeof Bun.serve>;
let productServer: ReturnType<typeof Bun.serve>;
let cartServer: ReturnType<typeof Bun.serve>;

const BASE = 'http://localhost';
const testEmail = `order-test-${Date.now()}@example.com`;
const testPassword = 'password123';

let accessToken = '';
let userId = '';
let activeSkuIds: string[] = [];
let addressId = '';
let createdOrderId = '';
let createdOrderNo = '';

/** 发送请求到 order-service（in-process） */
function req(path: string, body?: unknown, headers?: Record<string, string>) {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** 发送请求到 user-service（in-process） */
function userReq(path: string, body?: unknown, headers?: Record<string, string>) {
  return userApp.request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** 发送请求到 product-service（in-process） */
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

describe('Order API', () => {
  beforeAll(async () => {
    // 启动依赖服务（order-service 的 HTTP clients 调用这些端口）
    userServer = Bun.serve({ port: 3001, fetch: userApp.fetch });
    productServer = Bun.serve({ port: 3002, fetch: productApp.fetch });
    cartServer = Bun.serve({ port: 3003, fetch: cartApp.fetch });

    // 注册测试用户
    const registerRes = await userReq('/api/v1/auth/register', {
      email: testEmail,
      password: testPassword,
      nickname: '订单测试用户',
    });
    const registerJson = await registerRes.json();
    accessToken = registerJson.data.accessToken;

    // 获取 userId
    const profileRes = await userReq('/api/v1/user/profile', undefined, authHeaders());
    const profileJson = await profileRes.json();
    userId = profileJson.data.id;

    // 创建收货地址
    const addrRes = await userReq('/api/v1/user/address/create', {
      recipient: '张三',
      phone: '13800138000',
      province: '广东省',
      city: '深圳市',
      district: '南山区',
      address: '科技园路 100 号',
      postalCode: '518000',
      isDefault: true,
    }, authHeaders());
    const addrJson = await addrRes.json();
    addressId = addrJson.data.id;

    // 获取可用 SKU
    const listRes = await productReq('/api/v1/product/list', {
      page: 1,
      pageSize: 5,
      filters: { status: 'active' },
    });
    const listJson = await listRes.json();
    const productIds = listJson.data.items.map((p: any) => p.id);

    for (const pid of productIds) {
      const skuRes = await productReq('/api/v1/product/sku/list', { productId: pid });
      const skuJson = await skuRes.json();
      for (const sku of skuJson.data) {
        if (sku.status === 'active' && activeSkuIds.length < 3) {
          activeSkuIds.push(sku.id);
        }
      }
    }

    expect(activeSkuIds.length).toBeGreaterThanOrEqual(1);
  }, 15000);

  afterAll(async () => {
    // 清理测试数据 — 删除测试订单（需先删子表）
    if (createdOrderId) {
      await cleanupOrder(createdOrderId);
    }
    userServer?.stop();
    productServer?.stop();
    cartServer?.stop();
  });

  // ═══════════ 订单创建 ═══════════

  test('POST /api/v1/order/create — 缺少 X-Idempotency-Key → 400', async () => {
    const res = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuIds[0], quantity: 1 }],
      addressId,
    }, authHeaders());
    expect(res.status).toBe(400);
  });

  test('POST /api/v1/order/create — 成功创建订单', async () => {
    const idempotencyKey = `test-create-${Date.now()}`;
    const res = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuIds[0], quantity: 2 }],
      addressId,
      remark: '测试订单',
    }, authHeaders({ 'X-Idempotency-Key': idempotencyKey }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.orderId).toBeDefined();
    expect(json.data.orderNo).toBeDefined();
    expect(json.data.payAmount).toBeDefined();
    expect(json.data.expiresAt).toBeDefined();

    createdOrderId = json.data.orderId;
    createdOrderNo = json.data.orderNo;

    // 验证金额是服务端计算的（> 0）
    expect(parseFloat(json.data.payAmount)).toBeGreaterThan(0);

    // 验证 Redis 超时 ZSET 中有此订单
    const score = await redis.zscore('order:timeout', createdOrderId);
    expect(score).not.toBeNull();
  });

  test('POST /api/v1/order/create — 相同 idempotencyKey 返回原订单（幂等）', async () => {
    const idempotencyKey = `test-idempotent-${Date.now()}`;

    // 第一次创建
    const res1 = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuIds[0], quantity: 1 }],
      addressId,
    }, authHeaders({ 'X-Idempotency-Key': idempotencyKey }));
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    const firstOrderId = json1.data.orderId;

    // 第二次相同 key — 幂等中间件会拦截并返回 409 with original response
    // 或如果 key 在 DB 中匹配，service 层返回原订单
    const res2 = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuIds[0], quantity: 1 }],
      addressId,
    }, authHeaders({ 'X-Idempotency-Key': idempotencyKey }));

    const json2 = await res2.json();

    // 幂等中间件返回 409，或 service 层返回原订单
    if (res2.status === 409) {
      // 幂等中间件拦截
      expect(json2.meta.code).toBe('ORDER_4007');
    } else {
      // Service 层幂等返回
      expect(res2.status).toBe(200);
      expect(json2.data.orderId).toBe(firstOrderId);
    }

    // 清理额外创建的订单（需先删子表）
    if (res2.status === 200 && json2.data.orderId !== createdOrderId) {
      await cleanupOrder(json2.data.orderId);
    }
    if (json1.data.orderId !== createdOrderId) {
      await cleanupOrder(firstOrderId);
    }
  });

  test('POST /api/v1/order/create — 不存在的 SKU → 422', async () => {
    const res = await req('/api/v1/order/create', {
      items: [{ skuId: 'nonexistent-sku-id-xxxx', quantity: 1 }],
      addressId,
    }, authHeaders({ 'X-Idempotency-Key': `test-bad-sku-${Date.now()}` }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.meta.code).toBe('PRODUCT_2007');
  });

  test('POST /api/v1/order/create — 不存在的地址 → 404', async () => {
    const res = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuIds[0], quantity: 1 }],
      addressId: 'nonexistent-address-xx',
    }, authHeaders({ 'X-Idempotency-Key': `test-bad-addr-${Date.now()}` }));
    expect(res.status).toBe(404);
  });

  test('POST /api/v1/order/create — 无 token → 401', async () => {
    const res = await req('/api/v1/order/create', {
      items: [{ skuId: activeSkuIds[0], quantity: 1 }],
      addressId,
    }, { 'X-Idempotency-Key': `test-no-token-${Date.now()}` });
    expect(res.status).toBe(401);
  });

  // ═══════════ 订单查询 ═══════════

  test('POST /api/v1/order/list — 订单列表包含刚创建的订单', async () => {
    const res = await req('/api/v1/order/list', { page: 1, pageSize: 10 }, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items.length).toBeGreaterThanOrEqual(1);

    const found = json.data.items.find((i: any) => i.orderId === createdOrderId);
    expect(found).toBeDefined();
    expect(found.status).toBe('pending');
    expect(found.itemCount).toBe(1);
    expect(found.firstItem).toBeDefined();
  });

  test('POST /api/v1/order/list — 按状态过滤 pending', async () => {
    const res = await req('/api/v1/order/list', {
      page: 1,
      pageSize: 10,
      status: 'pending',
    }, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items.every((i: any) => i.status === 'pending')).toBe(true);
  });

  test('POST /api/v1/order/detail — 返回完整订单信息', async () => {
    const res = await req('/api/v1/order/detail', { orderId: createdOrderId }, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.orderId).toBe(createdOrderId);
    expect(json.data.orderNo).toBe(createdOrderNo);
    expect(json.data.status).toBe('pending');
    expect(json.data.items.length).toBeGreaterThanOrEqual(1);
    expect(json.data.address).toBeDefined();
    expect(json.data.address.recipient).toBe('张三');
    expect(json.data.remark).toBe('测试订单');

    // 金额校验
    expect(parseFloat(json.data.payAmount)).toBeGreaterThan(0);
    expect(json.data.totalAmount).toBeDefined();

    // items 快照
    const item = json.data.items[0];
    expect(item.productTitle).toBeDefined();
    expect(item.unitPrice).toBeDefined();
    expect(item.quantity).toBe(2);
    expect(item.subtotal).toBeDefined();
  });

  test('POST /api/v1/order/detail — 不存在的订单 → 404', async () => {
    const res = await req('/api/v1/order/detail', { orderId: 'nonexistent-id-xxxx' }, authHeaders());
    expect(res.status).toBe(404);
  });

  // ═══════════ 管理端 ═══════════

  test('POST /api/v1/admin/order/list — 管理端列表', async () => {
    const res = await req('/api/v1/admin/order/list', { page: 1, pageSize: 10 }, authHeaders());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items.length).toBeGreaterThanOrEqual(1);
  });

  test('POST /api/v1/admin/order/ship — pending 订单不能发货 → 422', async () => {
    const res = await req('/api/v1/admin/order/ship', { orderId: createdOrderId }, authHeaders());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.meta.code).toBe('ORDER_4002');
  });

  // ═══════════ 订单取消 ═══════════

  test('POST /api/v1/order/cancel — 取消 pending 订单成功', async () => {
    const res = await req('/api/v1/order/cancel', {
      orderId: createdOrderId,
      reason: '不想买了',
    }, authHeaders());
    expect(res.status).toBe(200);

    // 验证状态变更
    const detailRes = await req('/api/v1/order/detail', { orderId: createdOrderId }, authHeaders());
    const detailJson = await detailRes.json();
    expect(detailJson.data.status).toBe('cancelled');
    expect(detailJson.data.cancelledAt).toBeDefined();
    expect(detailJson.data.cancelReason).toBe('不想买了');

    // 验证 Redis timeout ZSET 已移除
    const score = await redis.zscore('order:timeout', createdOrderId);
    expect(score).toBeNull();
  });

  test('POST /api/v1/order/cancel — 重复取消 → 422', async () => {
    const res = await req('/api/v1/order/cancel', { orderId: createdOrderId }, authHeaders());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.meta.code).toBe('ORDER_4002');
  });

  // ═══════════ 健康检查 ═══════════

  test('POST /health — 健康检查', async () => {
    const res = await app.request(`${BASE}/health`, { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.service).toBe('order-service');
  });
});
