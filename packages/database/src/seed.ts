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
  banners,
  orders,
  orderItems,
  orderAddresses,
  paymentRecords,
  stockOperations,
} from './schema';

// ── 环境保护 ──
const env = process.env.NODE_ENV || 'development';
if (env === 'production') {
  console.error('Seed script is not allowed in production! Use seed:prod instead.');
  process.exit(1);
}

// ── 清空所有表（按外键依赖倒序）──
async function truncateAll() {
  // Order Service 域
  await db.execute(sql`TRUNCATE TABLE order_service.stock_operations CASCADE`);
  await db.execute(sql`TRUNCATE TABLE order_service.payment_records CASCADE`);
  await db.execute(sql`TRUNCATE TABLE order_service.order_addresses CASCADE`);
  await db.execute(sql`TRUNCATE TABLE order_service.order_items CASCADE`);
  await db.execute(sql`TRUNCATE TABLE order_service.orders CASCADE`);

  // Product Service 域
  await db.execute(sql`TRUNCATE TABLE product_service.banners CASCADE`);
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

// ── 辅助：dummyjson CDN 图片 URL ──
const CDN = 'https://cdn.dummyjson.com/product-images';
function cdnImg(path: string): string {
  return `${CDN}/${path}`;
}

// ── 辅助：placehold.co 占位图（仅用于 dummyjson 缺少的品类）──
function placeholderImg(text: string, bg = 'EEE', fg = '999'): string {
  return `https://placehold.co/800x800/${bg}/${fg}/webp?text=${encodeURIComponent(text)}&font=roboto`;
}

// ── 辅助：随机整数 ──
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── 辅助：随机评分 (3.5~5.0) ──
function randRating(): string {
  const r = 3.5 + Math.random() * 1.5;
  return (Math.round(r * 10) / 10).toFixed(1);
}

// ── 辅助：随机评价数 ──
function randReviews(): number {
  return randInt(50, 8000);
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
    { id: adminId, email: 'admin@test.com', password: hashedPw, nickname: 'Admin', status: 'active' },
    { id: aliceId, email: 'alice@test.com', password: hashedPw, nickname: 'Alice', status: 'active' },
    { id: bobId, email: 'bob@test.com', password: hashedPw, nickname: 'Bob', status: 'active' },
  ]);
  console.log('  3 users created (admin, alice, bob)\n');

  // ── 3. 用户地址 ──
  console.log('Inserting user addresses...');
  await db.insert(userAddresses).values([
    // Alice - 3 个地址
    {
      id: generateId(), userId: aliceId, label: '家',
      recipient: 'Alice Wang', phone: '13800138001',
      province: '上海市', city: '上海市', district: '浦东新区',
      address: '张江高科技园区 xxx 号', postalCode: '201203', isDefault: true,
    },
    {
      id: generateId(), userId: aliceId, label: '公司',
      recipient: 'Alice Wang', phone: '13800138001',
      province: '上海市', city: '上海市', district: '黄浦区',
      address: '南京东路 xxx 号', postalCode: '200001', isDefault: false,
    },
    {
      id: generateId(), userId: aliceId, label: '父母家',
      recipient: '王先生', phone: '13900139001',
      province: '北京市', city: '北京市', district: '朝阳区',
      address: '望京 SOHO xxx 号', postalCode: '100102', isDefault: false,
    },
    // Bob - 2 个地址
    {
      id: generateId(), userId: bobId, label: '家',
      recipient: 'Bob Li', phone: '13700137001',
      province: '广东省', city: '深圳市', district: '南山区',
      address: '科技园南区 xxx 号', postalCode: '518057', isDefault: true,
    },
    {
      id: generateId(), userId: bobId, label: '公司',
      recipient: 'Bob Li', phone: '13700137001',
      province: '广东省', city: '广州市', district: '天河区',
      address: '珠江新城 xxx 号', postalCode: '510623', isDefault: false,
    },
  ]);
  console.log('  5 addresses created (Alice 3, Bob 2)\n');

  // ══════════════════════════════════════════════════════════════
  // ── 4. 分类（10 个一级 + 25 个二级 = 35 个）──
  // ══════════════════════════════════════════════════════════════
  console.log('Inserting categories...');

  // 一级分类 ID
  const catDigital = generateId();
  const catComputer = generateId();
  const catAppliance = generateId();
  const catClothing = generateId();
  const catFood = generateId();
  const catBeauty = generateId();
  const catBooks = generateId();
  const catSports = generateId();
  const catHome = generateId();
  const catBaby = generateId();

  // 二级分类 ID
  const catPhone = generateId();
  const catEarphone = generateId();
  const catSmartWatch = generateId();
  const catLaptop = generateId();
  const catTablet = generateId();
  const catKeyboard = generateId();
  const catBigAppliance = generateId();
  const catSmallAppliance = generateId();
  const catKitchen = generateId();
  const catMenswear = generateId();
  const catWomenswear = generateId();
  const catShoes = generateId();
  const catSnacks = generateId();
  const catDrinks = generateId();
  const catFresh = generateId();
  const catSkincare = generateId();
  const catMakeup = generateId();
  const catWashCare = generateId();
  const catLiterature = generateId();
  const catEducation = generateId();
  const catComic = generateId();
  const catFitness = generateId();
  const catOutdoor = generateId();
  const catSportswear = generateId();
  const catFurniture = generateId();
  const catBedding = generateId();
  const catStorage = generateId();
  const catMilkPowder = generateId();
  const catDiaper = generateId();
  const catToys = generateId();

  await db.insert(categories).values([
    // 一级分类
    { id: catDigital, name: '手机数码', slug: 'digital', iconUrl: placeholderImg('Digital', '3B82F6', 'FFF'), sortOrder: 1 },
    { id: catComputer, name: '电脑办公', slug: 'computer', iconUrl: placeholderImg('PC', '6366F1', 'FFF'), sortOrder: 2 },
    { id: catAppliance, name: '家用电器', slug: 'appliance', iconUrl: placeholderImg('Home', 'F59E0B', 'FFF'), sortOrder: 3 },
    { id: catClothing, name: '服饰鞋包', slug: 'clothing', iconUrl: placeholderImg('Fashion', 'EC4899', 'FFF'), sortOrder: 4 },
    { id: catFood, name: '食品生鲜', slug: 'food', iconUrl: placeholderImg('Food', '22C55E', 'FFF'), sortOrder: 5 },
    { id: catBeauty, name: '美妆个护', slug: 'beauty', iconUrl: placeholderImg('Beauty', 'F472B6', 'FFF'), sortOrder: 6 },
    { id: catBooks, name: '图书音像', slug: 'books', iconUrl: placeholderImg('Books', '8B5CF6', 'FFF'), sortOrder: 7 },
    { id: catSports, name: '运动户外', slug: 'sports', iconUrl: placeholderImg('Sports', '14B8A6', 'FFF'), sortOrder: 8 },
    { id: catHome, name: '家居家装', slug: 'home', iconUrl: placeholderImg('Home', 'F97316', 'FFF'), sortOrder: 9 },
    { id: catBaby, name: '母婴玩具', slug: 'baby', iconUrl: placeholderImg('Baby', 'FB923C', 'FFF'), sortOrder: 10 },
    // 二级分类
    { id: catPhone, parentId: catDigital, name: '手机', slug: 'phones', sortOrder: 1 },
    { id: catEarphone, parentId: catDigital, name: '耳机', slug: 'earphones', sortOrder: 2 },
    { id: catSmartWatch, parentId: catDigital, name: '智能手表', slug: 'smart-watches', sortOrder: 3 },
    { id: catLaptop, parentId: catComputer, name: '笔记本电脑', slug: 'laptops', sortOrder: 1 },
    { id: catTablet, parentId: catComputer, name: '平板电脑', slug: 'tablets', sortOrder: 2 },
    { id: catKeyboard, parentId: catComputer, name: '键盘鼠标', slug: 'keyboards', sortOrder: 3 },
    { id: catBigAppliance, parentId: catAppliance, name: '冰箱洗衣机', slug: 'big-appliance', sortOrder: 1 },
    { id: catSmallAppliance, parentId: catAppliance, name: '小家电', slug: 'small-appliance', sortOrder: 2 },
    { id: catKitchen, parentId: catAppliance, name: '厨房电器', slug: 'kitchen-appliance', sortOrder: 3 },
    { id: catMenswear, parentId: catClothing, name: '男装', slug: 'menswear', sortOrder: 1 },
    { id: catWomenswear, parentId: catClothing, name: '女装', slug: 'womenswear', sortOrder: 2 },
    { id: catShoes, parentId: catClothing, name: '鞋靴', slug: 'shoes', sortOrder: 3 },
    { id: catSnacks, parentId: catFood, name: '零食', slug: 'snacks', sortOrder: 1 },
    { id: catDrinks, parentId: catFood, name: '饮料', slug: 'drinks', sortOrder: 2 },
    { id: catFresh, parentId: catFood, name: '生鲜', slug: 'fresh', sortOrder: 3 },
    { id: catSkincare, parentId: catBeauty, name: '护肤', slug: 'skincare', sortOrder: 1 },
    { id: catMakeup, parentId: catBeauty, name: '彩妆', slug: 'makeup', sortOrder: 2 },
    { id: catWashCare, parentId: catBeauty, name: '洗护', slug: 'wash-care', sortOrder: 3 },
    { id: catLiterature, parentId: catBooks, name: '文学', slug: 'literature', sortOrder: 1 },
    { id: catEducation, parentId: catBooks, name: '教育', slug: 'education', sortOrder: 2 },
    { id: catComic, parentId: catBooks, name: '漫画', slug: 'comic', sortOrder: 3 },
    { id: catFitness, parentId: catSports, name: '健身器材', slug: 'fitness', sortOrder: 1 },
    { id: catOutdoor, parentId: catSports, name: '户外装备', slug: 'outdoor', sortOrder: 2 },
    { id: catSportswear, parentId: catSports, name: '运动服饰', slug: 'sportswear', sortOrder: 3 },
    { id: catFurniture, parentId: catHome, name: '家具', slug: 'furniture', sortOrder: 1 },
    { id: catBedding, parentId: catHome, name: '床上用品', slug: 'bedding', sortOrder: 2 },
    { id: catStorage, parentId: catHome, name: '收纳', slug: 'storage', sortOrder: 3 },
    { id: catMilkPowder, parentId: catBaby, name: '奶粉', slug: 'milk-powder', sortOrder: 1 },
    { id: catDiaper, parentId: catBaby, name: '纸尿裤', slug: 'diapers', sortOrder: 2 },
    { id: catToys, parentId: catBaby, name: '玩具', slug: 'toys', sortOrder: 3 },
  ]);
  console.log('  40 categories created (10 top-level + 30 sub)\n');

  // ══════════════════════════════════════════════════════════════
  // ── 5. 商品 + 图片 + 分类关联 + SKU ──
  // ══════════════════════════════════════════════════════════════
  console.log('Inserting products, images, SKUs...');

  // 收集所有 SKU 用于 Redis 初始化
  const allSkuData: Array<{ id: string; stock: number }> = [];

  // 辅助：插入一个完整商品（product + images + category + skus）
  async function insertProduct(opts: {
    title: string;
    slug: string;
    description: string;
    brand: string;
    categoryId: string;
    minPrice: string;
    maxPrice: string;
    totalSales: number;
    avgRating: string;
    reviewCount: number;
    imageUrls: string[];
    skuList: Array<{
      code: string;
      price: string;
      comparePrice?: string;
      stock: number;
      lowStock?: number;
      attributes: Record<string, string>;
    }>;
  }) {
    const prodId = generateId();

    await db.insert(products).values({
      id: prodId,
      title: opts.title,
      slug: opts.slug,
      description: opts.description,
      brand: opts.brand,
      status: 'active',
      minPrice: opts.minPrice,
      maxPrice: opts.maxPrice,
      totalSales: opts.totalSales,
      avgRating: opts.avgRating,
      reviewCount: opts.reviewCount,
    });

    await db.insert(productImages).values(
      opts.imageUrls.map((url, i) => ({
        id: generateId(),
        productId: prodId,
        url,
        altText: `${opts.title} ${i + 1}`,
        isPrimary: i === 0,
        sortOrder: i,
      })),
    );

    await db.insert(productCategories).values([
      { productId: prodId, categoryId: opts.categoryId },
    ]);

    const skuValues = opts.skuList.map((s) => {
      const skuId = generateId();
      allSkuData.push({ id: skuId, stock: s.stock });
      return {
        id: skuId,
        productId: prodId,
        skuCode: s.code,
        price: s.price,
        comparePrice: s.comparePrice,
        stock: s.stock,
        lowStock: s.lowStock ?? 5,
        attributes: s.attributes,
      };
    });
    await db.insert(skus).values(skuValues);
  }

  // ────────────────────────────────────────
  // 手机数码 - 手机 (catPhone) 蓝色系 3B82F6
  // ────────────────────────────────────────
  await insertProduct({
    title: 'iPhone 15 Pro Max 256GB',
    slug: 'iphone-15-pro-max',
    description: 'Apple iPhone 15 Pro Max，A17 Pro 芯片，钛金属边框，超长续航',
    brand: 'Apple',
    categoryId: catPhone,
    minPrice: '9999.00', maxPrice: '13999.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('smartphones/iphone-13-pro/1.webp'), cdnImg('smartphones/iphone-13-pro/2.webp'), cdnImg('smartphones/iphone-13-pro/3.webp')],
    skuList: [
      { code: 'IP15PM-256-NAT', price: '9999.00', comparePrice: '10999.00', stock: 200, attributes: { storage: '256GB', color: '原色钛金属' } },
      { code: 'IP15PM-512-NAT', price: '11999.00', comparePrice: '12999.00', stock: 150, attributes: { storage: '512GB', color: '原色钛金属' } },
      { code: 'IP15PM-1T-BLK', price: '13999.00', comparePrice: '14999.00', stock: 80, lowStock: 10, attributes: { storage: '1TB', color: '黑色钛金属' } },
    ],
  });

  await insertProduct({
    title: '华为 Mate 60 Pro',
    slug: 'huawei-mate60-pro',
    description: '华为 Mate 60 Pro，麒麟芯片回归，卫星通话，昆仑玻璃',
    brand: '华为',
    categoryId: catPhone,
    minPrice: '6999.00', maxPrice: '7999.00',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('smartphones/samsung-galaxy-s8/1.webp'), cdnImg('smartphones/samsung-galaxy-s8/2.webp')],
    skuList: [
      { code: 'MATE60P-256-BLK', price: '6999.00', comparePrice: '7499.00', stock: 300, attributes: { storage: '256GB', color: '雅丹黑' } },
      { code: 'MATE60P-512-WHT', price: '7999.00', comparePrice: '8499.00', stock: 200, attributes: { storage: '512GB', color: '白沙银' } },
    ],
  });

  await insertProduct({
    title: '小米14 Ultra',
    slug: 'xiaomi-14-ultra',
    description: '小米14 Ultra，徕卡光学镜头，骁龙8 Gen3，专业影像旗舰',
    brand: '小米',
    categoryId: catPhone,
    minPrice: '5999.00', maxPrice: '6499.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('smartphones/oppo-f19-pro-plus/1.webp'), cdnImg('smartphones/realme-xt/1.webp')],
    skuList: [
      { code: 'MI14U-256-BLK', price: '5999.00', comparePrice: '6299.00', stock: 250, attributes: { storage: '256GB', color: '黑色' } },
      { code: 'MI14U-512-WHT', price: '6499.00', comparePrice: '6999.00', stock: 180, attributes: { storage: '512GB', color: '白色' } },
    ],
  });

  // 手机数码 - 耳机 (catEarphone)
  await insertProduct({
    title: 'AirPods Pro 第二代',
    slug: 'airpods-pro-2',
    description: 'Apple AirPods Pro 2，自适应降噪，个性化空间音频，USB-C 充电',
    brand: 'Apple',
    categoryId: catEarphone,
    minPrice: '1799.00', maxPrice: '1799.00',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('mobile-accessories/apple-airpods/1.webp'), cdnImg('mobile-accessories/apple-airpods/2.webp')],
    skuList: [
      { code: 'APP2-USBC', price: '1799.00', comparePrice: '1999.00', stock: 500, attributes: { version: 'USB-C', color: '白色' } },
    ],
  });

  await insertProduct({
    title: '索尼 WH-1000XM5 头戴式降噪耳机',
    slug: 'sony-wh1000xm5',
    description: '索尼旗舰降噪耳机，30小时续航，高解析度音频，佩戴舒适',
    brand: 'Sony',
    categoryId: catEarphone,
    minPrice: '2299.00', maxPrice: '2299.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('mobile-accessories/apple-airpods-max-silver/1.webp'), cdnImg('mobile-accessories/beats-flex-wireless-earphones/1.webp')],
    skuList: [
      { code: 'XM5-BLK', price: '2299.00', comparePrice: '2699.00', stock: 200, attributes: { color: '黑色' } },
      { code: 'XM5-SLV', price: '2299.00', comparePrice: '2699.00', stock: 150, attributes: { color: '铂金银' } },
    ],
  });

  // 手机数码 - 智能手表 (catSmartWatch)
  await insertProduct({
    title: 'Apple Watch Ultra 2',
    slug: 'apple-watch-ultra-2',
    description: 'Apple Watch Ultra 2，钛金属表壳，精准双频GPS，水下深度计',
    brand: 'Apple',
    categoryId: catSmartWatch,
    minPrice: '6499.00', maxPrice: '6499.00',
    totalSales: randInt(500, 2000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('mobile-accessories/apple-watch-series-4-gold/1.webp'), cdnImg('mobile-accessories/apple-watch-series-4-gold/2.webp')],
    skuList: [
      { code: 'AWU2-49-ORG', price: '6499.00', comparePrice: '6999.00', stock: 100, lowStock: 10, attributes: { size: '49mm', band: '橙色Alpine回环' } },
    ],
  });

  // ────────────────────────────────────────
  // 电脑办公 - 笔记本 (catLaptop) 靛蓝系 6366F1
  // ────────────────────────────────────────
  await insertProduct({
    title: 'MacBook Pro 14 英寸 M3 Pro',
    slug: 'macbook-pro-14-m3pro',
    description: 'Apple MacBook Pro 14 英寸，M3 Pro 芯片，Liquid Retina XDR 显示屏',
    brand: 'Apple',
    categoryId: catLaptop,
    minPrice: '14999.00', maxPrice: '19999.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('laptops/apple-macbook-pro-14-inch-space-grey/1.webp'), cdnImg('laptops/apple-macbook-pro-14-inch-space-grey/2.webp'), cdnImg('laptops/apple-macbook-pro-14-inch-space-grey/3.webp')],
    skuList: [
      { code: 'MBP14-M3P-18-512', price: '14999.00', comparePrice: '16499.00', stock: 120, attributes: { chip: 'M3 Pro', memory: '18GB', storage: '512GB' } },
      { code: 'MBP14-M3P-36-1T', price: '19999.00', comparePrice: '21999.00', stock: 60, lowStock: 10, attributes: { chip: 'M3 Pro', memory: '36GB', storage: '1TB' } },
    ],
  });

  await insertProduct({
    title: '联想 ThinkPad X1 Carbon Gen 11',
    slug: 'thinkpad-x1-carbon-11',
    description: '联想 ThinkPad X1 Carbon，14英寸2.8K OLED屏，轻薄商务本',
    brand: 'Lenovo',
    categoryId: catLaptop,
    minPrice: '9999.00', maxPrice: '12999.00',
    totalSales: randInt(800, 2500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('laptops/lenovo-yoga-920/1.webp'), cdnImg('laptops/lenovo-yoga-920/2.webp')],
    skuList: [
      { code: 'X1C11-i5-16-512', price: '9999.00', comparePrice: '11499.00', stock: 100, attributes: { cpu: 'i5-1340P', memory: '16GB', storage: '512GB' } },
      { code: 'X1C11-i7-32-1T', price: '12999.00', comparePrice: '14999.00', stock: 80, attributes: { cpu: 'i7-1365H', memory: '32GB', storage: '1TB' } },
    ],
  });

  // 电脑办公 - 平板 (catTablet)
  await insertProduct({
    title: 'iPad Air M2',
    slug: 'ipad-air-m2',
    description: 'Apple iPad Air M2 芯片，11英寸 Liquid Retina 显示屏，支持 Apple Pencil Pro',
    brand: 'Apple',
    categoryId: catTablet,
    minPrice: '4799.00', maxPrice: '6499.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('tablets/ipad-mini-2021-starlight/1.webp'), cdnImg('tablets/ipad-mini-2021-starlight/2.webp')],
    skuList: [
      { code: 'IPAM2-128-BLU', price: '4799.00', comparePrice: '5299.00', stock: 200, attributes: { storage: '128GB', color: '蓝色' } },
      { code: 'IPAM2-256-PUR', price: '5499.00', comparePrice: '5999.00', stock: 150, attributes: { storage: '256GB', color: '紫色' } },
      { code: 'IPAM2-512-GRY', price: '6499.00', comparePrice: '6999.00', stock: 100, attributes: { storage: '512GB', color: '深空灰' } },
    ],
  });

  await insertProduct({
    title: '华为 MatePad Pro 13.2 英寸',
    slug: 'huawei-matepad-pro-13',
    description: '华为 MatePad Pro 13.2，OLED柔性屏，星闪连接，天生会画',
    brand: '华为',
    categoryId: catTablet,
    minPrice: '5199.00', maxPrice: '5999.00',
    totalSales: randInt(500, 2000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('tablets/samsung-galaxy-tab-s8-plus-grey/1.webp'), cdnImg('tablets/samsung-galaxy-tab-s8-plus-grey/2.webp')],
    skuList: [
      { code: 'MPP13-256-BLK', price: '5199.00', comparePrice: '5699.00', stock: 120, attributes: { storage: '256GB', color: '曜金黑' } },
      { code: 'MPP13-512-WHT', price: '5999.00', comparePrice: '6499.00', stock: 80, attributes: { storage: '512GB', color: '晶钻白' } },
    ],
  });

  // 电脑办公 - 键盘鼠标 (catKeyboard)
  await insertProduct({
    title: 'HHKB Professional HYBRID Type-S',
    slug: 'hhkb-hybrid-types',
    description: 'HHKB 静电容键盘，蓝牙/USB双模，静音版，程序员神器',
    brand: 'HHKB',
    categoryId: catKeyboard,
    minPrice: '2499.00', maxPrice: '2499.00',
    totalSales: randInt(300, 1500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('HHKB+Keyboard', '333', 'FFF'), placeholderImg('HHKB+Type-S', '333', 'FFF')],
    skuList: [
      { code: 'HHKB-HTS-WHT', price: '2499.00', comparePrice: '2799.00', stock: 80, lowStock: 10, attributes: { color: '白色', layout: '60键' } },
      { code: 'HHKB-HTS-BLK', price: '2499.00', comparePrice: '2799.00', stock: 60, lowStock: 10, attributes: { color: '墨色', layout: '60键' } },
    ],
  });

  // ────────────────────────────────────────
  // 家用电器 (catAppliance) 琥珀色系 F59E0B
  // ────────────────────────────────────────
  await insertProduct({
    title: '戴森 V15 Detect 无绳吸尘器',
    slug: 'dyson-v15-detect',
    description: '戴森 V15 Detect，激光探测灰尘，整机密封HEPA过滤，60分钟续航',
    brand: 'Dyson',
    categoryId: catSmallAppliance,
    minPrice: '4590.00', maxPrice: '4590.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('Dyson+V15', 'F59E0B', 'FFF'), placeholderImg('Dyson+Detect', 'D97706', 'FFF'), placeholderImg('Dyson+HEPA', 'B45309', 'FFF')],
    skuList: [
      { code: 'V15-DETECT-GLD', price: '4590.00', comparePrice: '5490.00', stock: 100, attributes: { color: '金色', version: '旗舰版' } },
    ],
  });

  await insertProduct({
    title: '海尔冰箱 BCD-510WDPZ',
    slug: 'haier-fridge-510',
    description: '海尔510升对开门冰箱，风冷无霜，变频节能，干湿分储',
    brand: '海尔',
    categoryId: catBigAppliance,
    minPrice: '3299.00', maxPrice: '3299.00',
    totalSales: randInt(800, 2000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('Haier+Fridge', '60A5FA', 'FFF'), placeholderImg('Haier+510L', '3B82F6', 'FFF')],
    skuList: [
      { code: 'HAIER-510-GLD', price: '3299.00', comparePrice: '3999.00', stock: 50, lowStock: 10, attributes: { color: '金色', capacity: '510L' } },
    ],
  });

  await insertProduct({
    title: '美的电饭煲 MB-FB40Simple',
    slug: 'midea-rice-cooker-fb40',
    description: '美的智能电饭煲，4L大容量，24小时预约，多功能菜单',
    brand: '美的',
    categoryId: catKitchen,
    minPrice: '299.00', maxPrice: '299.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('kitchen-accessories/electric-stove/1.webp'), cdnImg('kitchen-accessories/silver-pot-with-glass-cap/1.webp')],
    skuList: [
      { code: 'MIDEA-FB40-WHT', price: '299.00', comparePrice: '399.00', stock: 300, attributes: { color: '白色', capacity: '4L' } },
    ],
  });

  // ────────────────────────────────────────
  // 服饰鞋包 (catClothing) 粉色系 EC4899
  // ────────────────────────────────────────
  await insertProduct({
    title: 'Nike Dri-FIT 速干运动T恤 男款',
    slug: 'nike-drifit-tshirt-men',
    description: 'Nike Dri-FIT 科技面料，吸湿排汗，运动休闲百搭款',
    brand: 'Nike',
    categoryId: catMenswear,
    minPrice: '229.00', maxPrice: '229.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('mens-shirts/man-short-sleeve-shirt/1.webp'), cdnImg('mens-shirts/man-short-sleeve-shirt/2.webp')],
    skuList: [
      { code: 'NIKE-DF-M-S-BLK', price: '229.00', comparePrice: '299.00', stock: 300, attributes: { size: 'S', color: '黑色' } },
      { code: 'NIKE-DF-M-M-BLK', price: '229.00', comparePrice: '299.00', stock: 400, attributes: { size: 'M', color: '黑色' } },
      { code: 'NIKE-DF-M-L-BLK', price: '229.00', comparePrice: '299.00', stock: 350, attributes: { size: 'L', color: '黑色' } },
      { code: 'NIKE-DF-M-XL-BLK', price: '229.00', comparePrice: '299.00', stock: 200, attributes: { size: 'XL', color: '黑色' } },
    ],
  });

  await insertProduct({
    title: 'Adidas Ultraboost Light 跑步鞋',
    slug: 'adidas-ultraboost-light',
    description: 'Adidas Ultraboost Light，轻量化BOOST中底，编织鞋面，缓震舒适',
    brand: 'Adidas',
    categoryId: catShoes,
    minPrice: '1099.00', maxPrice: '1099.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('mens-shoes/sports-sneakers-off-white-&-red/1.webp'), cdnImg('mens-shoes/sports-sneakers-off-white-&-red/2.webp'), cdnImg('mens-shoes/sports-sneakers-off-white-&-red/3.webp')],
    skuList: [
      { code: 'UBL-40-BLK', price: '1099.00', comparePrice: '1299.00', stock: 100, attributes: { size: '40', color: '黑白' } },
      { code: 'UBL-42-BLK', price: '1099.00', comparePrice: '1299.00', stock: 120, attributes: { size: '42', color: '黑白' } },
      { code: 'UBL-43-BLK', price: '1099.00', comparePrice: '1299.00', stock: 80, lowStock: 10, attributes: { size: '43', color: '黑白' } },
    ],
  });

  await insertProduct({
    title: '优衣库 女式轻薄羽绒服',
    slug: 'uniqlo-ultra-light-down-women',
    description: '优衣库 Ultra Light Down，超轻便携，90%优质白鸭绒，可收纳',
    brand: 'UNIQLO',
    categoryId: catWomenswear,
    minPrice: '499.00', maxPrice: '499.00',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('tops/gray-dress/1.webp'), cdnImg('tops/gray-dress/2.webp')],
    skuList: [
      { code: 'UQ-ULD-W-S-PNK', price: '499.00', comparePrice: '599.00', stock: 200, attributes: { size: 'S', color: '樱花粉' } },
      { code: 'UQ-ULD-W-M-BLK', price: '499.00', comparePrice: '599.00', stock: 250, attributes: { size: 'M', color: '黑色' } },
      { code: 'UQ-ULD-W-L-NVY', price: '499.00', comparePrice: '599.00', stock: 180, attributes: { size: 'L', color: '藏青' } },
    ],
  });

  await insertProduct({
    title: 'Levi\'s 501 经典直筒牛仔裤 男款',
    slug: 'levis-501-original-men',
    description: 'Levi\'s 501 Original，经典直筒剪裁，纯棉牛仔布，百年经典',
    brand: 'Levi\'s',
    categoryId: catMenswear,
    minPrice: '599.00', maxPrice: '599.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('mens-shirts/blue-&-black-check-shirt/1.webp'), cdnImg('mens-shirts/blue-&-black-check-shirt/2.webp')],
    skuList: [
      { code: 'LEVI501-30-BLU', price: '599.00', comparePrice: '799.00', stock: 150, attributes: { size: '30', color: '中蓝' } },
      { code: 'LEVI501-32-BLU', price: '599.00', comparePrice: '799.00', stock: 200, attributes: { size: '32', color: '中蓝' } },
      { code: 'LEVI501-34-DRK', price: '599.00', comparePrice: '799.00', stock: 130, attributes: { size: '34', color: '深蓝' } },
    ],
  });

  // ────────────────────────────────────────
  // 食品生鲜 (catFood) 绿色系 22C55E
  // ────────────────────────────────────────
  await insertProduct({
    title: '三只松鼠 每日坚果混合装 30包',
    slug: 'three-squirrels-daily-nuts',
    description: '三只松鼠每日坚果，6种坚果+3种果干，独立小包装，锁鲜工艺',
    brand: '三只松鼠',
    categoryId: catSnacks,
    minPrice: '69.90', maxPrice: '129.00',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('groceries/mulberry/1.webp'), cdnImg('groceries/honey-jar/1.webp')],
    skuList: [
      { code: 'SZS-NUTS-15', price: '69.90', comparePrice: '89.90', stock: 500, attributes: { spec: '15包装' } },
      { code: 'SZS-NUTS-30', price: '129.00', comparePrice: '159.00', stock: 400, attributes: { spec: '30包装' } },
    ],
  });

  await insertProduct({
    title: '农夫山泉 天然矿泉水 550ml×24瓶',
    slug: 'nongfu-spring-water-24',
    description: '农夫山泉天然水，优质水源地，不含任何添加剂',
    brand: '农夫山泉',
    categoryId: catDrinks,
    minPrice: '29.90', maxPrice: '29.90',
    totalSales: randInt(4000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('groceries/water/1.webp'), cdnImg('groceries/juice/1.webp')],
    skuList: [
      { code: 'NFS-550-24', price: '29.90', comparePrice: '39.90', stock: 500, attributes: { spec: '550ml×24瓶' } },
    ],
  });

  await insertProduct({
    title: '精品咖啡豆 哥伦比亚单一产区',
    slug: 'premium-coffee-colombia',
    description: '哥伦比亚单一产区精品咖啡豆，中深烘焙，坚果巧克力风味',
    brand: 'BeanMaster',
    categoryId: catDrinks,
    minPrice: '68.00', maxPrice: '128.00',
    totalSales: randInt(800, 2500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('groceries/nescafe-coffee/1.webp'), cdnImg('groceries/ice-cream/1.webp')],
    skuList: [
      { code: 'COFFEE-200G', price: '68.00', comparePrice: '88.00', stock: 200, attributes: { weight: '200g', roast: '中深烘焙' } },
      { code: 'COFFEE-500G', price: '128.00', comparePrice: '158.00', stock: 150, attributes: { weight: '500g', roast: '中深烘焙' } },
    ],
  });

  await insertProduct({
    title: '智利进口车厘子 JJ级 2斤装',
    slug: 'chile-cherry-jj-2lb',
    description: '智利进口车厘子，JJ级大果，果径28-30mm，新鲜空运直达',
    brand: '鲜果时光',
    categoryId: catFresh,
    minPrice: '129.00', maxPrice: '129.00',
    totalSales: randInt(1500, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('groceries/strawberry/1.webp'), cdnImg('groceries/kiwi/1.webp')],
    skuList: [
      { code: 'CHERRY-JJ-2LB', price: '129.00', comparePrice: '169.00', stock: 80, lowStock: 10, attributes: { spec: '2斤装', grade: 'JJ级' } },
    ],
  });

  // ────────────────────────────────────────
  // 美妆个护 (catBeauty) 粉色系 F472B6
  // ────────────────────────────────────────
  await insertProduct({
    title: 'SK-II 神仙水 护肤精华露 230ml',
    slug: 'skii-facial-treatment-essence',
    description: 'SK-II 神仙水，93.4% PITERA精华，改善肤质，提亮肤色',
    brand: 'SK-II',
    categoryId: catSkincare,
    minPrice: '1370.00', maxPrice: '1370.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('skin-care/olay-ultra-moisture-shea-butter-body-wash/1.webp'), cdnImg('skin-care/olay-ultra-moisture-shea-butter-body-wash/2.webp')],
    skuList: [
      { code: 'SKII-FTE-230', price: '1370.00', comparePrice: '1590.00', stock: 200, attributes: { spec: '230ml' } },
    ],
  });

  await insertProduct({
    title: 'MAC 魅可 子弹头口红',
    slug: 'mac-lipstick-bullet',
    description: 'MAC 经典子弹头口红，高饱和色彩，丝缎质地，持久不脱色',
    brand: 'MAC',
    categoryId: catMakeup,
    minPrice: '230.00', maxPrice: '230.00',
    totalSales: randInt(2500, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('beauty/red-lipstick/1.webp'), cdnImg('beauty/eyeshadow-palette-with-mirror/1.webp')],
    skuList: [
      { code: 'MAC-LS-RUBY', price: '230.00', comparePrice: '270.00', stock: 300, attributes: { color: 'Ruby Woo', finish: '哑光' } },
      { code: 'MAC-LS-CHILI', price: '230.00', comparePrice: '270.00', stock: 250, attributes: { color: 'Chili', finish: '哑光' } },
      { code: 'MAC-LS-VELVET', price: '230.00', comparePrice: '270.00', stock: 200, attributes: { color: 'Velvet Teddy', finish: '哑光' } },
    ],
  });

  await insertProduct({
    title: '欧莱雅 玻尿酸洗发水 700ml',
    slug: 'loreal-hyaluronic-shampoo',
    description: '欧莱雅透明质酸洗发水，深层补水，柔顺亮泽，无硅油配方',
    brand: "L'Oreal",
    categoryId: catWashCare,
    minPrice: '69.90', maxPrice: '69.90',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('skin-care/vaseline-men-body-and-face-lotion/1.webp'), cdnImg('skin-care/attitude-super-leaves-hand-soap/1.webp')],
    skuList: [
      { code: 'LOREAL-HA-SH-700', price: '69.90', comparePrice: '89.90', stock: 400, attributes: { spec: '700ml', type: '柔顺型' } },
    ],
  });

  // ────────────────────────────────────────
  // 图书音像 (catBooks) 紫色系 8B5CF6
  // ────────────────────────────────────────
  await insertProduct({
    title: '三体（全三册）刘慈欣',
    slug: 'three-body-problem-trilogy',
    description: '刘慈欣科幻巨著，雨果奖获奖作品，中国科幻里程碑',
    brand: '重庆出版社',
    categoryId: catLiterature,
    minPrice: '93.00', maxPrice: '93.00',
    totalSales: randInt(4000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('Three+Body', '1E1B4B', 'E0E7FF'), placeholderImg('Dark+Forest', '312E81', 'C7D2FE')],
    skuList: [
      { code: 'SANTI-3BOOK', price: '93.00', comparePrice: '168.00', stock: 500, attributes: { version: '典藏版', format: '纸质书' } },
    ],
  });

  await insertProduct({
    title: 'JavaScript高级程序设计 第4版',
    slug: 'professional-javascript-4th',
    description: '红宝书，前端开发必读经典，全面覆盖ES6+特性',
    brand: '人民邮电出版社',
    categoryId: catEducation,
    minPrice: '99.00', maxPrice: '99.00',
    totalSales: randInt(1500, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('JavaScript', 'FEF08A', '854D0E'), placeholderImg('ES6+', 'FDE047', '713F12')],
    skuList: [
      { code: 'PROJS-4TH', price: '99.00', comparePrice: '129.00', stock: 300, attributes: { version: '第4版', format: '纸质书' } },
    ],
  });

  await insertProduct({
    title: '海贼王 航海王漫画 1-106卷',
    slug: 'one-piece-manga-1-106',
    description: '尾田荣一郎经典漫画，全球累计发行超5亿册',
    brand: '浙江人民美术出版社',
    categoryId: catComic,
    minPrice: '5.90', maxPrice: '1999.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('One+Piece', 'DC2626', 'FEF2F2'), placeholderImg('Luffy', 'B91C1C', 'FEE2E2')],
    skuList: [
      { code: 'OP-SINGLE', price: '5.90', comparePrice: '7.90', stock: 500, attributes: { spec: '单册', format: '漫画' } },
      { code: 'OP-BOX-1-106', price: '1999.00', comparePrice: '2499.00', stock: 50, lowStock: 10, attributes: { spec: '全套1-106卷', format: '漫画' } },
    ],
  });

  // ────────────────────────────────────────
  // 运动户外 (catSports) 青色系 14B8A6
  // ────────────────────────────────────────
  await insertProduct({
    title: 'Keep 智能动感单车 C1',
    slug: 'keep-smart-bike-c1',
    description: 'Keep 智能动感单车，磁控阻力，AI私教课程，静音飞轮',
    brand: 'Keep',
    categoryId: catFitness,
    minPrice: '1999.00', maxPrice: '1999.00',
    totalSales: randInt(500, 2000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('Keep+Bike', '0D9488', 'F0FDFA'), placeholderImg('Smart+Bike', '115E59', 'CCFBF1'), placeholderImg('AI+Coach', '134E4A', 'D1FAE5')],
    skuList: [
      { code: 'KEEP-C1-WHT', price: '1999.00', comparePrice: '2499.00', stock: 80, attributes: { color: '白色' } },
    ],
  });

  await insertProduct({
    title: '北面 The North Face 冲锋衣 男款',
    slug: 'tnf-gore-tex-jacket-men',
    description: 'The North Face GORE-TEX 冲锋衣，防水防风透气，户外徒步必备',
    brand: 'The North Face',
    categoryId: catOutdoor,
    minPrice: '1999.00', maxPrice: '1999.00',
    totalSales: randInt(800, 2500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('GORE-TEX', '166534', 'F0FDF4'), placeholderImg('TNF+Jacket', '14532D', 'DCFCE7')],
    skuList: [
      { code: 'TNF-GTX-M-M-BLK', price: '1999.00', comparePrice: '2599.00', stock: 100, attributes: { size: 'M', color: '黑色' } },
      { code: 'TNF-GTX-M-L-BLK', price: '1999.00', comparePrice: '2599.00', stock: 120, attributes: { size: 'L', color: '黑色' } },
      { code: 'TNF-GTX-M-XL-NVY', price: '1999.00', comparePrice: '2599.00', stock: 80, attributes: { size: 'XL', color: '藏青' } },
    ],
  });

  await insertProduct({
    title: 'Nike Air Zoom Pegasus 40 跑鞋',
    slug: 'nike-pegasus-40',
    description: 'Nike 飞马40，Air Zoom 气垫，React 泡棉，日常训练跑鞋',
    brand: 'Nike',
    categoryId: catSportswear,
    minPrice: '699.00', maxPrice: '699.00',
    totalSales: randInt(2000, 4500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('mens-shoes/nike-air-jordan-1-red-and-black/1.webp'), cdnImg('mens-shoes/nike-air-jordan-1-red-and-black/2.webp')],
    skuList: [
      { code: 'PEG40-41-BLK', price: '699.00', comparePrice: '899.00', stock: 150, attributes: { size: '41', color: '黑白' } },
      { code: 'PEG40-42-BLK', price: '699.00', comparePrice: '899.00', stock: 200, attributes: { size: '42', color: '黑白' } },
      { code: 'PEG40-43-BLU', price: '699.00', comparePrice: '899.00', stock: 130, attributes: { size: '43', color: '蓝白' } },
    ],
  });

  // ────────────────────────────────────────
  // 家居家装 (catHome) 橙色系 F97316
  // ────────────────────────────────────────
  await insertProduct({
    title: '源氏木语 实木书桌 1.2m',
    slug: 'genji-solid-wood-desk-120',
    description: '北美白橡木实木书桌，简约日式风格，榫卯工艺，环保水性漆',
    brand: '源氏木语',
    categoryId: catFurniture,
    minPrice: '1599.00', maxPrice: '1999.00',
    totalSales: randInt(500, 1500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('furniture/bedside-table-african-cherry/1.webp'), cdnImg('furniture/bedside-table-african-cherry/2.webp'), cdnImg('furniture/bedside-table-african-cherry/3.webp')],
    skuList: [
      { code: 'GENJI-DESK-120', price: '1599.00', comparePrice: '1999.00', stock: 60, attributes: { size: '120×60cm', material: '白橡木' } },
      { code: 'GENJI-DESK-140', price: '1999.00', comparePrice: '2399.00', stock: 50, attributes: { size: '140×70cm', material: '白橡木' } },
    ],
  });

  await insertProduct({
    title: '富安娜 100支长绒棉四件套',
    slug: 'fuanna-100s-cotton-bedding',
    description: '富安娜100支新疆长绒棉四件套，丝滑亲肤，高端轻奢床品',
    brand: '富安娜',
    categoryId: catBedding,
    minPrice: '899.00', maxPrice: '899.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('furniture/annibale-colombo-bed/1.webp'), cdnImg('furniture/annibale-colombo-bed/2.webp')],
    skuList: [
      { code: 'FUANNA-4PC-1.5-WHT', price: '899.00', comparePrice: '1299.00', stock: 100, attributes: { size: '1.5m床', color: '珍珠白' } },
      { code: 'FUANNA-4PC-1.8-GRY', price: '899.00', comparePrice: '1299.00', stock: 120, attributes: { size: '1.8m床', color: '高级灰' } },
    ],
  });

  await insertProduct({
    title: '天马收纳箱 可叠加大号 3个装',
    slug: 'tenma-storage-box-3pack',
    description: '天马收纳箱，PP材质，透明可视，可叠加，衣物换季收纳',
    brand: '天马',
    categoryId: catStorage,
    minPrice: '99.00', maxPrice: '159.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('home-decoration/house-showpiece-plant/1.webp'), cdnImg('home-decoration/plant-pot/1.webp')],
    skuList: [
      { code: 'TENMA-56L-3PK', price: '99.00', comparePrice: '129.00', stock: 300, attributes: { spec: '56L×3个', color: '透明' } },
      { code: 'TENMA-78L-3PK', price: '159.00', comparePrice: '199.00', stock: 200, attributes: { spec: '78L×3个', color: '透明' } },
    ],
  });

  // ────────────────────────────────────────
  // 母婴玩具 (catBaby) 暖橙色系 FB923C
  // ────────────────────────────────────────
  await insertProduct({
    title: '飞鹤 星飞帆 婴幼儿配方奶粉 3段 700g',
    slug: 'firmus-starship-stage3',
    description: '飞鹤星飞帆3段，适合1-3岁宝宝，新鲜生牛乳一次成粉',
    brand: '飞鹤',
    categoryId: catMilkPowder,
    minPrice: '236.00', maxPrice: '436.00',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('groceries/milk/1.webp'), cdnImg('groceries/protein-powder/1.webp')],
    skuList: [
      { code: 'FIRMUS-S3-700', price: '236.00', comparePrice: '278.00', stock: 300, attributes: { spec: '700g', stage: '3段' } },
      { code: 'FIRMUS-S3-700x2', price: '436.00', comparePrice: '556.00', stock: 200, attributes: { spec: '700g×2罐', stage: '3段' } },
    ],
  });

  await insertProduct({
    title: '花王 妙而舒 婴儿纸尿裤 L54片',
    slug: 'merries-diaper-l54',
    description: '花王妙而舒纸尿裤，三层透气设计，柔软触感，干爽不闷',
    brand: '花王',
    categoryId: catDiaper,
    minPrice: '109.00', maxPrice: '199.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('Merries+L', 'FEF3C7', 'B45309'), placeholderImg('Merries+XL', 'FDE68A', '92400E')],
    skuList: [
      { code: 'MERRIES-L-54', price: '109.00', comparePrice: '139.00', stock: 400, attributes: { size: 'L', spec: '54片' } },
      { code: 'MERRIES-XL-44', price: '109.00', comparePrice: '139.00', stock: 350, attributes: { size: 'XL', spec: '44片' } },
      { code: 'MERRIES-L-108', price: '199.00', comparePrice: '259.00', stock: 200, attributes: { size: 'L', spec: '108片(2包)' } },
    ],
  });

  await insertProduct({
    title: '乐高 LEGO 机械组 布加迪 42151',
    slug: 'lego-technic-bugatti-42151',
    description: '乐高机械组布加迪跑车，905片零件，可动引擎和变速箱',
    brand: 'LEGO',
    categoryId: catToys,
    minPrice: '349.00', maxPrice: '349.00',
    totalSales: randInt(800, 2500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('LEGO+Bugatti', 'DC2626', 'FEF2F2'), placeholderImg('LEGO+42151', 'B91C1C', 'FEE2E2'), placeholderImg('905+Pieces', '991B1B', 'FECACA')],
    skuList: [
      { code: 'LEGO-42151', price: '349.00', comparePrice: '449.00', stock: 150, lowStock: 10, attributes: { pieces: '905', age: '9+' } },
    ],
  });

  await insertProduct({
    title: 'B.Duck 小黄鸭 儿童滑板车',
    slug: 'bduck-kids-scooter',
    description: 'B.Duck 小黄鸭儿童三轮滑板车，可折叠，可调节高度，闪光轮',
    brand: 'B.Duck',
    categoryId: catToys,
    minPrice: '199.00', maxPrice: '199.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('B.Duck+Scooter', 'FACC15', '422006'), placeholderImg('Kids+Scooter', 'EAB308', '3F3700')],
    skuList: [
      { code: 'BDUCK-SCOOT-YLW', price: '199.00', comparePrice: '269.00', stock: 200, attributes: { color: '黄色', ageRange: '3-8岁' } },
      { code: 'BDUCK-SCOOT-PNK', price: '199.00', comparePrice: '269.00', stock: 150, attributes: { color: '粉色', ageRange: '3-8岁' } },
    ],
  });

  // ── 追加几个高销量/特色商品 ──

  await insertProduct({
    title: 'Samsung Galaxy S24 Ultra',
    slug: 'samsung-galaxy-s24-ultra',
    description: '三星 Galaxy S24 Ultra，钛金属边框，Galaxy AI，2亿像素，S Pen',
    brand: 'Samsung',
    categoryId: catPhone,
    minPrice: '9699.00', maxPrice: '13699.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('smartphones/samsung-galaxy-s10/1.webp'), cdnImg('smartphones/samsung-galaxy-s10/2.webp'), cdnImg('smartphones/samsung-galaxy-s10/3.webp')],
    skuList: [
      { code: 'S24U-256-BLK', price: '9699.00', comparePrice: '10499.00', stock: 180, attributes: { storage: '256GB', color: '钛黑' } },
      { code: 'S24U-512-VIO', price: '11699.00', comparePrice: '12499.00', stock: 120, attributes: { storage: '512GB', color: '钛紫' } },
      { code: 'S24U-1T-GRY', price: '13699.00', comparePrice: '14499.00', stock: 60, lowStock: 10, attributes: { storage: '1TB', color: '钛灰' } },
    ],
  });

  await insertProduct({
    title: '戴森 Supersonic 吹风机 HD15',
    slug: 'dyson-supersonic-hd15',
    description: '戴森吹风机 HD15，智能温控，防飞翘风嘴，5款造型风嘴',
    brand: 'Dyson',
    categoryId: catSmallAppliance,
    minPrice: '3199.00', maxPrice: '3199.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [placeholderImg('Dyson+HD15', 'EC4899', 'FFF'), placeholderImg('Dyson+Supersonic', 'DB2777', 'FFF')],
    skuList: [
      { code: 'DYSON-HD15-FUC', price: '3199.00', comparePrice: '3599.00', stock: 150, attributes: { color: '紫红镍色' } },
      { code: 'DYSON-HD15-BLU', price: '3199.00', comparePrice: '3599.00', stock: 120, attributes: { color: '璀璨蓝金' } },
    ],
  });

  await insertProduct({
    title: '碎花连衣裙 法式复古气质款',
    slug: 'floral-dress-french-vintage',
    description: '法式复古碎花连衣裙，V领收腰设计，雪纺面料，优雅气质',
    brand: 'ElegantLady',
    categoryId: catWomenswear,
    minPrice: '299.00', maxPrice: '299.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: [cdnImg('womens-dresses/dress-pea/1.webp'), cdnImg('womens-dresses/dress-pea/2.webp'), cdnImg('womens-dresses/dress-pea/3.webp')],
    skuList: [
      { code: 'FD-FV-S-FLR', price: '299.00', comparePrice: '459.00', stock: 180, attributes: { size: 'S', color: '碎花白' } },
      { code: 'FD-FV-M-FLR', price: '299.00', comparePrice: '459.00', stock: 220, attributes: { size: 'M', color: '碎花白' } },
      { code: 'FD-FV-L-FLR', price: '299.00', comparePrice: '459.00', stock: 150, attributes: { size: 'L', color: '碎花白' } },
    ],
  });

  const totalProducts = 42;
  console.log(`  ${totalProducts} products, ${allSkuData.length} SKUs created\n`);

  // ══════════════════════════════════════════════════════════════
  // ── 6. 首页 Banner 轮播图 ──
  // ══════════════════════════════════════════════════════════════
  console.log('Inserting banners...');
  await db.insert(banners).values([
    {
      id: generateId(),
      title: '春季数码焕新',
      subtitle: '手机电脑限时特惠，最高立减2000元',
      imageUrl: cdnImg('smartphones/iphone-13-pro/1.webp'),
      linkType: 'category',
      linkValue: 'digital',
      sortOrder: 1,
      isActive: true,
    },
    {
      id: generateId(),
      title: 'iPhone 15 Pro Max',
      subtitle: 'A17 Pro 芯片，钛金属边框，从9999起',
      imageUrl: cdnImg('smartphones/iphone-13-pro/2.webp'),
      linkType: 'product',
      linkValue: 'iphone-15-pro-max',
      sortOrder: 2,
      isActive: true,
    },
    {
      id: generateId(),
      title: '时尚女装专场',
      subtitle: '春夏新品上市，满299减50',
      imageUrl: cdnImg('womens-dresses/dress-pea/1.webp'),
      linkType: 'category',
      linkValue: 'womenswear',
      sortOrder: 3,
      isActive: true,
    },
    {
      id: generateId(),
      title: '戴森超级品牌日',
      subtitle: '吸尘器/吹风机全线优惠',
      imageUrl: placeholderImg('Dyson+V15+Detect', 'F59E0B', 'FFF'),
      linkType: 'product',
      linkValue: 'dyson-v15-detect',
      sortOrder: 4,
      isActive: true,
    },
    {
      id: generateId(),
      title: '图书满100减50',
      subtitle: '经典文学、教育、漫画全场参与',
      imageUrl: placeholderImg('Best+Sellers', '7C3AED', 'F5F3FF'),
      linkType: 'category',
      linkValue: 'books',
      sortOrder: 5,
      isActive: true,
    },
    {
      id: generateId(),
      title: '生鲜好物精选',
      subtitle: '新鲜水果产地直发，次日达',
      imageUrl: cdnImg('groceries/strawberry/1.webp'),
      linkType: 'category',
      linkValue: 'fresh',
      sortOrder: 6,
      isActive: true,
    },
  ]);
  console.log('  6 banners created\n');

  // ── 7. 初始化 Redis 库存 ──
  console.log('Initializing Redis stock...');
  for (const sku of allSkuData) {
    await setStock(redis, sku.id, sku.stock);
  }
  console.log(`  ${allSkuData.length} SKU stock keys initialized\n`);

  // ── 统计 ──
  console.log('=== Seed Summary ===');
  console.log('  Users:      3');
  console.log('  Addresses:  5');
  console.log('  Categories: 40 (10 top-level + 30 sub)');
  console.log(`  Products:   ${totalProducts}`);
  console.log(`  SKUs:       ${allSkuData.length}`);
  console.log('  Banners:    6');
  console.log(`  Redis keys: ${allSkuData.length} (stock:*)`);
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
