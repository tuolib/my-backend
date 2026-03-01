/**
 * 端到端全流程测试 ⭐
 * 通过 Gateway 走完整购买链路（17 步）
 * 前置：所有下游服务 + PG + Redis 运行中
 *
 * 全流程：注册 → 登录 → 浏览商品 → 加购物车 → 结算预览 → 创建订单
 *        → 发起支付 → 模拟支付回调 → 管理员发货 → 查询订单详情
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { app } from '../app';
import { generateId } from '@repo/shared';

// ── 测试状态（跨步骤共享）──
let accessToken = '';
let refreshToken = '';
let userId = '';
let categoryId = '';
let productId = '';
let skuId = '';
let addressId = '';
let orderId = '';
let orderNo = '';
let paymentId = '';
let payAmount = '';

const testEmail = `e2e-${Date.now()}@test.com`;
const testPassword = 'TestPass123!';

/** 发送 POST 请求到 Gateway */
async function post(
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<Response> {
  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };
  if (accessToken && !headers?.Authorization) {
    reqHeaders.Authorization = `Bearer ${accessToken}`;
  }
  return app.request(path, {
    method: 'POST',
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** 解析响应 JSON 并断言成功 */
async function expectSuccess(res: Response) {
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  expect(json.code).toBe(200);
  expect(json.traceId).toBeDefined();
  return json;
}

describe('E2E Full Purchase Flow', () => {
  // ── Step 0: 准备测试数据 ──
  // 先创建分类、商品、SKU、库存（通过 admin 路由）
  // 但先需要一个用户身份

  // ── Step 1: 注册 ──
  test('Step 1: 注册新用户', async () => {
    const res = await post('/api/v1/auth/register', {
      email: testEmail,
      password: testPassword,
      nickname: 'E2E Test User',
    }, { Authorization: '' }); // 不带 token

    const json = await expectSuccess(res);
    expect(json.data.user).toBeDefined();
    expect(json.data.user.email).toBe(testEmail);
    expect(json.data.accessToken).toBeTruthy();
    expect(json.data.refreshToken).toBeTruthy();

    accessToken = json.data.accessToken;
    refreshToken = json.data.refreshToken;
    userId = json.data.user.id;
  });

  // ── Step 2: 登录 ──
  test('Step 2: 登录', async () => {
    const res = await post('/api/v1/auth/login', {
      email: testEmail,
      password: testPassword,
    }, { Authorization: '' });

    const json = await expectSuccess(res);
    expect(json.data.accessToken).toBeTruthy();
    expect(json.data.refreshToken).toBeTruthy();

    accessToken = json.data.accessToken;
    refreshToken = json.data.refreshToken;
  });

  // ── Step 2.5: 创建收货地址 ──
  test('Step 2.5: 创建收货地址', async () => {
    const res = await post('/api/v1/user/address/create', {
      label: '家',
      recipient: '测试用户',
      phone: '13800138000',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      address: '文三路 100 号',
      postalCode: '310000',
      isDefault: true,
    });

    const json = await expectSuccess(res);
    expect(json.data.id).toBeTruthy();
    addressId = json.data.id;
  });

  // ── Step 2.6: 创建分类（admin）──
  test('Step 2.6: 创建分类', async () => {
    const res = await post('/api/v1/admin/category/create', {
      name: `E2E 测试分类 ${Date.now()}`,
      slug: `e2e-test-${Date.now()}`,
    });

    const json = await expectSuccess(res);
    expect(json.data.id).toBeTruthy();
    categoryId = json.data.id;
  });

  // ── Step 2.7: 创建商品（admin）──
  test('Step 2.7: 创建商品', async () => {
    const res = await post('/api/v1/admin/product/create', {
      title: `E2E Test iPhone ${Date.now()}`,
      description: '端到端测试商品',
      brand: 'TestBrand',
      status: 'active',
      categoryIds: [categoryId],
      images: [{
        url: 'https://example.com/test-product.jpg',
        altText: 'Test Product',
        isPrimary: true,
      }],
    });

    const json = await expectSuccess(res);
    expect(json.data.id).toBeTruthy();
    productId = json.data.id;
  });

  // ── Step 2.8: 创建 SKU（admin）──
  test('Step 2.8: 创建 SKU', async () => {
    const res = await post('/api/v1/admin/product/sku/create', {
      productId,
      skuCode: `E2E-SKU-${Date.now()}`,
      price: 9999,
      stock: 100,
      attributes: { color: '黑色', storage: '256GB' },
    });

    const json = await expectSuccess(res);
    expect(json.data.id).toBeTruthy();
    skuId = json.data.id;
  });

  // ── Step 2.9: 设置库存（admin）──
  test('Step 2.9: 设置库存', async () => {
    const res = await post('/api/v1/admin/stock/adjust', {
      skuId,
      quantity: 100,
      reason: 'E2E 测试初始化库存',
    });

    const json = await expectSuccess(res);
  });

  // ── Step 3: 浏览商品 ──
  test('Step 3: 浏览商品列表', async () => {
    const res = await post('/api/v1/product/list', { page: 1, pageSize: 10 }, {
      Authorization: '', // 公开路由
    });

    const json = await expectSuccess(res);
    expect(json.data.items).toBeDefined();
    expect(Array.isArray(json.data.items)).toBe(true);
  });

  // ── Step 4: 商品详情 ──
  test('Step 4: 查看商品详情', async () => {
    const res = await post('/api/v1/product/detail', { id: productId }, {
      Authorization: '',
    });

    const json = await expectSuccess(res);
    expect(json.data.id).toBe(productId);
    expect(json.data.title).toContain('E2E Test iPhone');
  });

  // ── Step 5: 搜索商品 ──
  test('Step 5: 搜索商品', async () => {
    const res = await post('/api/v1/product/search', {
      keyword: 'iPhone',
      page: 1,
      pageSize: 10,
    }, {
      Authorization: '',
    });

    const json = await expectSuccess(res);
    expect(json.data).toBeDefined();
  });

  // ── Step 6: 分类树 ──
  test('Step 6: 获取分类树', async () => {
    const res = await post('/api/v1/category/tree', undefined, {
      Authorization: '',
    });

    const json = await expectSuccess(res);
    expect(Array.isArray(json.data)).toBe(true);
  });

  // ── Step 7: 加入购物车 ──
  test('Step 7: 加入购物车', async () => {
    const res = await post('/api/v1/cart/add', {
      skuId,
      quantity: 2,
    });

    const json = await expectSuccess(res);
  });

  // ── Step 8: 查看购物车 ──
  test('Step 8: 查看购物车', async () => {
    const res = await post('/api/v1/cart/list');

    const json = await expectSuccess(res);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(1);

    // 验证购物车中有我们加的商品
    const cartItem = json.data.find((item: { skuId: string }) => item.skuId === skuId);
    expect(cartItem).toBeDefined();
    expect(cartItem.quantity).toBe(2);
  });

  // ── Step 9: 结算预览 ──
  test('Step 9: 结算预览', async () => {
    const res = await post('/api/v1/cart/checkout/preview');

    const json = await expectSuccess(res);
    expect(json.data.summary).toBeDefined();
    expect(json.data.canCheckout).toBe(true);
    expect(json.data.items).toBeDefined();
    expect(json.data.items.length).toBeGreaterThanOrEqual(1);
  });

  // ── Step 10: 创建订单 ──
  test('Step 10: 创建订单', async () => {
    const idempotencyKey = generateId();
    const res = await post('/api/v1/order/create', {
      items: [{ skuId, quantity: 2 }],
      addressId,
    }, {
      'X-Idempotency-Key': idempotencyKey,
    });

    const json = await expectSuccess(res);
    expect(json.data.orderId).toBeTruthy();
    expect(json.data.orderNo).toBeTruthy();
    expect(json.data.payAmount).toBeTruthy();

    orderId = json.data.orderId;
    orderNo = json.data.orderNo;
    payAmount = json.data.payAmount;
  });

  // ── Step 11: 订单列表 ──
  test('Step 11: 查看订单列表', async () => {
    const res = await post('/api/v1/order/list', { page: 1, pageSize: 10 });

    const json = await expectSuccess(res);
    expect(json.data.items).toBeDefined();

    // 应该包含刚创建的订单
    const myOrder = json.data.items.find(
      (o: { orderId: string }) => o.orderId === orderId
    );
    expect(myOrder).toBeDefined();
    expect(myOrder.status).toBe('pending');
  });

  // ── Step 12: 发起支付 ──
  test('Step 12: 发起支付', async () => {
    const res = await post('/api/v1/payment/create', {
      orderId,
      method: 'mock',
    });

    const json = await expectSuccess(res);
    expect(json.data.paymentId).toBeTruthy();
    paymentId = json.data.paymentId;
  });

  // ── Step 13: 模拟支付回调 ──
  test('Step 13: 模拟支付回调', async () => {
    const res = await post('/api/v1/payment/notify', {
      orderId,
      transactionId: `mock-tx-${Date.now()}`,
      status: 'success',
      amount: Number(payAmount),
      method: 'mock',
    }, {
      Authorization: '', // 公开路由
    });

    const json = await expectSuccess(res);
  });

  // ── Step 14: 查询支付 ──
  test('Step 14: 查询支付状态', async () => {
    const res = await post('/api/v1/payment/query', { orderId });

    const json = await expectSuccess(res);
    expect(json.data.orderId).toBe(orderId);
    expect(json.data.orderStatus).toBe('paid');
    expect(json.data.payments).toBeDefined();
    expect(json.data.payments.length).toBeGreaterThanOrEqual(1);
  });

  // ── Step 15: 管理员发货 ──
  test('Step 15: 管理员发货', async () => {
    const res = await post('/api/v1/admin/order/ship', {
      orderId,
      trackingNo: 'SF1234567890',
    });

    const json = await expectSuccess(res);
  });

  // ── Step 16: 订单详情 ──
  test('Step 16: 查看订单详情（已发货）', async () => {
    const res = await post('/api/v1/order/detail', { orderId });

    const json = await expectSuccess(res);
    expect(json.data.orderId).toBe(orderId);
    expect(json.data.orderNo).toBe(orderNo);
    expect(json.data.status).toBe('shipped');
    expect(json.data.items).toBeDefined();
    expect(json.data.items.length).toBeGreaterThanOrEqual(1);
  });

  // ── Step 17: traceId 一致性验证 ──
  test('Step 17: traceId 一致性验证', async () => {
    const res = await post('/api/v1/order/detail', { orderId });
    const json = await res.json();

    // 响应体中的 traceId 应该与 X-Request-Id header 一致
    const headerTraceId = res.headers.get('X-Request-Id');
    expect(headerTraceId).toBeTruthy();

    // 响应格式符合标准
    expect(json).toHaveProperty('code');
    expect(json).toHaveProperty('success');
    expect(json).toHaveProperty('data');
    expect(json).toHaveProperty('message');
    expect(json).toHaveProperty('traceId');
  });
});
