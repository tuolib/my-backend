/**
 * 库存并发安全性压测
 * 验证零超卖：N 个用户并发下单同一 SKU，成功数不超过库存量
 * 用法：bun run scripts/stress-test.ts [concurrency] [baseUrl]
 */

const CONCURRENCY = Number(process.argv[2]) || 100;
const BASE_URL = process.argv[3] || 'http://localhost:80';

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<any>;
}

async function main() {
  console.log('=== Stock Concurrency Stress Test ===');
  console.log('Concurrency:', CONCURRENCY);
  console.log('Target:', BASE_URL);
  console.log('');

  // 1. 注册测试用户并获取 tokens
  console.log('Registering users...');
  const tokens: string[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const data = await post('/api/v1/auth/register', {
      email: `stress-${Date.now()}-${i}@test.com`,
      password: 'password12345678',
    });
    if (!data.data?.accessToken) {
      console.error('Register failed at user', i, data);
      process.exit(1);
    }
    tokens.push(data.data.accessToken);
  }
  console.log('Registered:', tokens.length, 'users');

  // 2. 获取一个测试 SKU
  const productData = await post('/api/v1/product/list', { page: 1, pageSize: 1 });
  const productId = productData.data?.items?.[0]?.id;
  if (!productId) {
    console.error('No products found. Run seed first.');
    process.exit(1);
  }

  const skuData = await post('/api/v1/product/detail', { id: productId });
  const sku = skuData.data?.skus?.[0];
  if (!sku) {
    console.error('No SKUs found for product', productId);
    process.exit(1);
  }

  const skuId = sku.id;
  const initialStock = sku.stock;
  console.log('Target SKU:', skuId, '| Initial stock:', initialStock);

  // 3. 为第一个用户创建收货地址
  await post(
    '/api/v1/user/address/create',
    {
      recipient: 'Stress Tester',
      phone: '13800000000',
      province: 'Test',
      city: 'Test',
      district: 'Test',
      address: 'Test Address',
    },
    { Authorization: `Bearer ${tokens[0]}` },
  );

  const addrData = await post('/api/v1/user/address/list', {}, {
    Authorization: `Bearer ${tokens[0]}`,
  });
  const addressId = addrData.data?.[0]?.id;
  if (!addressId) {
    console.error('Failed to create address');
    process.exit(1);
  }

  // 4. 并发下单
  console.log('\nStarting concurrent orders...');
  const start = Date.now();

  const results = await Promise.allSettled(
    tokens.map((token, i) =>
      post(
        '/api/v1/order/create',
        { items: [{ skuId, quantity: 1 }], addressId },
        {
          Authorization: `Bearer ${token}`,
          'X-Idempotency-Key': `stress-${Date.now()}-${i}`,
        },
      ),
    ),
  );

  const elapsed = Date.now() - start;

  // 5. 统计结果
  let successCount = 0;
  let failCount = 0;
  const errorDetails: Record<string, number> = {};

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.success) {
      successCount++;
    } else {
      failCount++;
      const code =
        r.status === 'fulfilled'
          ? r.value.meta?.code || 'UNKNOWN'
          : 'NETWORK_ERROR';
      errorDetails[code] = (errorDetails[code] || 0) + 1;
    }
  }

  console.log('\n=== Results ===');
  console.log('Elapsed:', elapsed, 'ms');
  console.log('Success:', successCount);
  console.log('Failed:', failCount);
  console.log('Error breakdown:', errorDetails);
  console.log('Expected max success:', Math.min(CONCURRENCY, initialStock));

  // 6. 验证库存
  const finalData = await post('/api/v1/product/detail', { id: productId });
  const finalSku = finalData.data?.skus?.find((s: any) => s.id === skuId);
  const finalStock = finalSku?.stock ?? 'unknown';

  console.log('\n=== Stock Verification ===');
  console.log('Initial stock:', initialStock);
  console.log('Successful orders:', successCount);
  console.log('Expected remaining:', initialStock - successCount);
  console.log('Actual DB stock:', finalStock);

  if (successCount <= initialStock) {
    console.log('\n[PASS] Zero oversell verified!');
  } else {
    console.log('\n[FAIL] Potential oversell detected!');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Stress test error:', err);
  process.exit(1);
});
