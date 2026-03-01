/**
 * 开发环境种子数据
 * 幂等执行：先清空所有表（按外键依赖顺序），再插入
 * 用法: bun run seed (从 packages/database 目录)
 */
import { sql } from 'drizzle-orm';
import { db, connection } from './client';
import { redis } from './redis';
import { generateId } from '@repo/shared';
import { hashPassword } from '@repo/shared';
import { setStock } from './lua';
import {
  users,
  userAddresses,
  refreshTokens,
  categories,
  products,
  productCategories,
  productImages,
  skus,
  orders,
  orderItems,
  orderAddresses,
  paymentRecords,
  stockOperations,
} from './schema';

// ── 清空所有表（按外键依赖倒序）──
async function truncateAll() {
  // Order Service 域
  await db.execute(sql`TRUNCATE TABLE order_service.stock_operations CASCADE`);
  await db.execute(sql`TRUNCATE TABLE order_service.payment_records CASCADE`);
  await db.execute(sql`TRUNCATE TABLE order_service.order_addresses CASCADE`);
  await db.execute(sql`TRUNCATE TABLE order_service.order_items CASCADE`);
  await db.execute(sql`TRUNCATE TABLE order_service.orders CASCADE`);

  // Product Service 域
  await db.execute(sql`TRUNCATE TABLE product_service.skus CASCADE`);
  await db.execute(sql`TRUNCATE TABLE product_service.product_images CASCADE`);
  await db.execute(sql`TRUNCATE TABLE product_service.product_categories CASCADE`);
  await db.execute(sql`TRUNCATE TABLE product_service.products CASCADE`);
  await db.execute(sql`TRUNCATE TABLE product_service.categories CASCADE`);

  // User Service 域
  await db.execute(sql`TRUNCATE TABLE user_service.refresh_tokens CASCADE`);
  await db.execute(sql`TRUNCATE TABLE user_service.user_addresses CASCADE`);
  await db.execute(sql`TRUNCATE TABLE user_service.users CASCADE`);
}

// ── 清空 Redis 库存 key ──
async function clearRedisStock() {
  const keys = await redis.keys('stock:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

async function seed() {
  console.log('Seeding database...\n');

  // 1. 清空
  console.log('Truncating all tables...');
  await truncateAll();
  await clearRedisStock();
  console.log('Done.\n');

  // ── 2. 用户 ──
  console.log('Inserting users...');
  const hashedPw = await hashPassword('password123');

  const adminId = generateId();
  const aliceId = generateId();
  const bobId = generateId();

  await db.insert(users).values([
    {
      id: adminId,
      email: 'admin@test.com',
      password: hashedPw,
      nickname: 'Admin',
      status: 'active',
    },
    {
      id: aliceId,
      email: 'alice@test.com',
      password: hashedPw,
      nickname: 'Alice',
      status: 'active',
    },
    {
      id: bobId,
      email: 'bob@test.com',
      password: hashedPw,
      nickname: 'Bob',
      status: 'active',
    },
  ]);
  console.log(`  3 users created (admin, alice, bob)\n`);

  // ── 3. 用户地址（Alice 的）──
  console.log('Inserting user addresses...');
  await db.insert(userAddresses).values([
    {
      id: generateId(),
      userId: aliceId,
      label: '家',
      recipient: 'Alice Wang',
      phone: '13800138001',
      province: '上海市',
      city: '上海市',
      district: '浦东新区',
      address: '张江高科技园区 xxx 号',
      postalCode: '201203',
      isDefault: true,
    },
    {
      id: generateId(),
      userId: aliceId,
      label: '公司',
      recipient: 'Alice Wang',
      phone: '13800138001',
      province: '上海市',
      city: '上海市',
      district: '黄浦区',
      address: '南京东路 xxx 号',
      postalCode: '200001',
      isDefault: false,
    },
  ]);
  console.log(`  2 addresses created (Alice)\n`);

  // ── 4. 分类 ──
  console.log('Inserting categories...');
  const catElectronics = generateId();
  const catClothing = generateId();
  const catFood = generateId();
  const catPhones = generateId();
  const catComputers = generateId();
  const catMenswear = generateId();
  const catWomenswear = generateId();

  await db.insert(categories).values([
    // 顶级分类
    { id: catElectronics, name: '电子产品', slug: 'electronics', sortOrder: 1 },
    { id: catClothing, name: '服装', slug: 'clothing', sortOrder: 2 },
    { id: catFood, name: '食品', slug: 'food', sortOrder: 3 },
    // 子分类
    { id: catPhones, parentId: catElectronics, name: '手机', slug: 'phones', sortOrder: 1 },
    { id: catComputers, parentId: catElectronics, name: '电脑', slug: 'computers', sortOrder: 2 },
    { id: catMenswear, parentId: catClothing, name: '男装', slug: 'menswear', sortOrder: 1 },
    { id: catWomenswear, parentId: catClothing, name: '女装', slug: 'womenswear', sortOrder: 2 },
  ]);
  console.log(`  7 categories created (3 top-level + 4 sub)\n`);

  // ── 5. 商品 + 图片 + 分类关联 + SKU ──
  console.log('Inserting products, images, SKUs...');

  // 收集所有 SKU ID 用于 Redis 初始化
  const allSkuIds: string[] = [];

  // --- iPhone 15 Pro ---
  const prodIphone = generateId();
  const skuIphone128 = generateId();
  const skuIphone256 = generateId();
  allSkuIds.push(skuIphone128, skuIphone256);

  await db.insert(products).values({
    id: prodIphone,
    title: 'iPhone 15 Pro',
    slug: 'iphone-15-pro',
    description: 'Apple iPhone 15 Pro，A17 Pro 芯片，钛金属边框',
    brand: 'Apple',
    status: 'active',
    minPrice: '7999.00',
    maxPrice: '9999.00',
  });
  await db.insert(productImages).values([
    { id: generateId(), productId: prodIphone, url: 'https://placehold.co/800x800?text=iPhone15Pro-1', altText: 'iPhone 15 Pro 正面', isPrimary: true, sortOrder: 0 },
    { id: generateId(), productId: prodIphone, url: 'https://placehold.co/800x800?text=iPhone15Pro-2', altText: 'iPhone 15 Pro 背面', isPrimary: false, sortOrder: 1 },
  ]);
  await db.insert(productCategories).values([
    { productId: prodIphone, categoryId: catPhones },
  ]);
  await db.insert(skus).values([
    { id: skuIphone128, productId: prodIphone, skuCode: 'IPHONE15P-128', price: '7999.00', comparePrice: '8499.00', stock: 100, attributes: { storage: '128GB', color: '原色钛金属' } },
    { id: skuIphone256, productId: prodIphone, skuCode: 'IPHONE15P-256', price: '9999.00', comparePrice: '10499.00', stock: 100, attributes: { storage: '256GB', color: '原色钛金属' } },
  ]);

  // --- MacBook Pro 14 ---
  const prodMacbook = generateId();
  const skuMacM3 = generateId();
  const skuMacM3Pro = generateId();
  allSkuIds.push(skuMacM3, skuMacM3Pro);

  await db.insert(products).values({
    id: prodMacbook,
    title: 'MacBook Pro 14 英寸',
    slug: 'macbook-pro-14',
    description: 'Apple MacBook Pro 14 英寸，M3 系列芯片',
    brand: 'Apple',
    status: 'active',
    minPrice: '12999.00',
    maxPrice: '17999.00',
  });
  await db.insert(productImages).values([
    { id: generateId(), productId: prodMacbook, url: 'https://placehold.co/800x800?text=MacBookPro14-1', altText: 'MacBook Pro 14 正面', isPrimary: true, sortOrder: 0 },
  ]);
  await db.insert(productCategories).values([
    { productId: prodMacbook, categoryId: catComputers },
  ]);
  await db.insert(skus).values([
    { id: skuMacM3, productId: prodMacbook, skuCode: 'MBP14-M3', price: '12999.00', comparePrice: '13999.00', stock: 100, attributes: { chip: 'M3', memory: '8GB', storage: '512GB' } },
    { id: skuMacM3Pro, productId: prodMacbook, skuCode: 'MBP14-M3PRO', price: '17999.00', comparePrice: '18999.00', stock: 100, attributes: { chip: 'M3 Pro', memory: '18GB', storage: '512GB' } },
  ]);

  // --- 运动T恤 ---
  const prodTshirt = generateId();
  const skuTshirtS = generateId();
  const skuTshirtM = generateId();
  const skuTshirtL = generateId();
  allSkuIds.push(skuTshirtS, skuTshirtM, skuTshirtL);

  await db.insert(products).values({
    id: prodTshirt,
    title: '运动T恤',
    slug: 'sport-tshirt',
    description: '透气速干面料，适合运动和日常穿着',
    brand: 'SportX',
    status: 'active',
    minPrice: '99.00',
    maxPrice: '99.00',
  });
  await db.insert(productImages).values([
    { id: generateId(), productId: prodTshirt, url: 'https://placehold.co/800x800?text=SportTshirt', altText: '运动T恤', isPrimary: true, sortOrder: 0 },
  ]);
  await db.insert(productCategories).values([
    { productId: prodTshirt, categoryId: catMenswear },
  ]);
  await db.insert(skus).values([
    { id: skuTshirtS, productId: prodTshirt, skuCode: 'TSHIRT-S', price: '99.00', stock: 100, attributes: { size: 'S', color: '黑色' } },
    { id: skuTshirtM, productId: prodTshirt, skuCode: 'TSHIRT-M', price: '99.00', stock: 100, attributes: { size: 'M', color: '黑色' } },
    { id: skuTshirtL, productId: prodTshirt, skuCode: 'TSHIRT-L', price: '99.00', stock: 100, attributes: { size: 'L', color: '黑色' } },
  ]);

  // --- 连衣裙 ---
  const prodDress = generateId();
  const skuDressS = generateId();
  const skuDressM = generateId();
  allSkuIds.push(skuDressS, skuDressM);

  await db.insert(products).values({
    id: prodDress,
    title: '碎花连衣裙',
    slug: 'floral-dress',
    description: '优雅碎花连衣裙，适合春夏季节',
    brand: 'ElegantLady',
    status: 'active',
    minPrice: '299.00',
    maxPrice: '299.00',
  });
  await db.insert(productImages).values([
    { id: generateId(), productId: prodDress, url: 'https://placehold.co/800x800?text=FloralDress-1', altText: '碎花连衣裙 正面', isPrimary: true, sortOrder: 0 },
    { id: generateId(), productId: prodDress, url: 'https://placehold.co/800x800?text=FloralDress-2', altText: '碎花连衣裙 侧面', isPrimary: false, sortOrder: 1 },
  ]);
  await db.insert(productCategories).values([
    { productId: prodDress, categoryId: catWomenswear },
  ]);
  await db.insert(skus).values([
    { id: skuDressS, productId: prodDress, skuCode: 'DRESS-S', price: '299.00', stock: 100, attributes: { size: 'S', color: '碎花白' } },
    { id: skuDressM, productId: prodDress, skuCode: 'DRESS-M', price: '299.00', stock: 100, attributes: { size: 'M', color: '碎花白' } },
  ]);

  // --- 有机坚果 ---
  const prodNuts = generateId();
  const skuNuts = generateId();
  allSkuIds.push(skuNuts);

  await db.insert(products).values({
    id: prodNuts,
    title: '有机每日坚果',
    slug: 'organic-nuts',
    description: '混合坚果，每日一包，健康零食',
    brand: 'NatureFarm',
    status: 'active',
    minPrice: '59.90',
    maxPrice: '59.90',
  });
  await db.insert(productImages).values([
    { id: generateId(), productId: prodNuts, url: 'https://placehold.co/800x800?text=OrganicNuts', altText: '有机坚果', isPrimary: true, sortOrder: 0 },
  ]);
  await db.insert(productCategories).values([
    { productId: prodNuts, categoryId: catFood },
  ]);
  await db.insert(skus).values([
    { id: skuNuts, productId: prodNuts, skuCode: 'NUTS-30PACK', price: '59.90', stock: 100, attributes: { spec: '30包/盒' } },
  ]);

  // --- 精品咖啡豆 ---
  const prodCoffee = generateId();
  const skuCoffee200 = generateId();
  const skuCoffee500 = generateId();
  allSkuIds.push(skuCoffee200, skuCoffee500);

  await db.insert(products).values({
    id: prodCoffee,
    title: '精品咖啡豆',
    slug: 'premium-coffee',
    description: '哥伦比亚单一产区精品咖啡豆，中深烘焙',
    brand: 'BeanMaster',
    status: 'active',
    minPrice: '68.00',
    maxPrice: '128.00',
  });
  await db.insert(productImages).values([
    { id: generateId(), productId: prodCoffee, url: 'https://placehold.co/800x800?text=PremiumCoffee-1', altText: '精品咖啡豆包装', isPrimary: true, sortOrder: 0 },
    { id: generateId(), productId: prodCoffee, url: 'https://placehold.co/800x800?text=PremiumCoffee-2', altText: '咖啡豆特写', isPrimary: false, sortOrder: 1 },
  ]);
  await db.insert(productCategories).values([
    { productId: prodCoffee, categoryId: catFood },
  ]);
  await db.insert(skus).values([
    { id: skuCoffee200, productId: prodCoffee, skuCode: 'COFFEE-200G', price: '68.00', stock: 100, attributes: { weight: '200g', roast: '中深烘焙' } },
    { id: skuCoffee500, productId: prodCoffee, skuCode: 'COFFEE-500G', price: '128.00', stock: 100, attributes: { weight: '500g', roast: '中深烘焙' } },
  ]);

  console.log(`  6 products, ${allSkuIds.length} SKUs created\n`);

  // ── 6. 初始化 Redis 库存 ──
  console.log('Initializing Redis stock...');
  for (const skuId of allSkuIds) {
    await setStock(redis, skuId, 100);
  }
  console.log(`  ${allSkuIds.length} SKU stock keys set to 100\n`);

  // ── 统计 ──
  console.log('=== Seed Summary ===');
  console.log(`  Users:      3`);
  console.log(`  Addresses:  2`);
  console.log(`  Categories: 7`);
  console.log(`  Products:   6`);
  console.log(`  SKUs:       ${allSkuIds.length}`);
  console.log(`  Redis keys: ${allSkuIds.length} (stock:*)`);
  console.log('====================\n');
}

// ── 执行入口 ──
seed()
  .then(() => {
    console.log('Seed completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
