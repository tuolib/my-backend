/**
 * 开发环境种子数据
 * 幂等执行：先清空所有表（按外键依赖顺序），再插入
 * 用法: bun run seed (从 packages/database 目录)
 */
import { sql } from 'drizzle-orm';
import { db, connection } from './client';
import { redis } from './redis';
import { hashPassword } from '@repo/shared';
import { setStock } from './lua';
import { bulkCatalog } from './seed-prod-catalog';
import { categoryImagePool } from './seed-images';
import { seedId } from './seed-id';
import {
  admins,
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

// ── 清空商品与订单表（保留用户数据）──
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
  await redis.del('product:category:tree');
  console.log('Done.\n');

  // ── 2. 用户 ──
  console.log('Inserting users...');
  const hashedPw = await hashPassword('password123');

  // 测试用户：仅在不存在时插入（ON CONFLICT DO NOTHING）
  const adminId = seedId('user:admin@test.com');
  const aliceId = seedId('user:alice@test.com');
  const bobId = seedId('user:bob@test.com');

  await db.insert(users).values([
    { id: adminId, email: 'admin@test.com', password: hashedPw, nickname: 'Admin', status: 'active' },
    { id: aliceId, email: 'alice@test.com', password: hashedPw, nickname: 'Alice', status: 'active' },
    { id: bobId, email: 'bob@test.com', password: hashedPw, nickname: 'Bob', status: 'active' },
  ]).onConflictDoNothing({ target: users.email });
  console.log('  Test users ensured (admin, alice, bob)\n');

  // ── 3. 管理员 ──
  console.log('Inserting admin...');
  const adminPw = await hashPassword('admin');
  await db.insert(admins).values({
    id: seedId('admin:admin'),
    username: 'admin',
    password: adminPw,
    realName: '超级管理员',
    role: 'admin',
    isSuper: true,
    status: 'active',
    mustChangePassword: false,
  }).onConflictDoNothing({ target: admins.username });
  console.log('  Admin ensured (admin/admin)\n');

  // ══════════════════════════════════════════════════════════════
  // ── 4. 分类（10 个一级 + 25 个二级 = 35 个）──
  // ══════════════════════════════════════════════════════════════
  console.log('Inserting categories...');

  // 一级分类 ID（确定性，与 seed-prod.ts 一致）
  const catDigital = seedId('cat:digital');
  const catComputer = seedId('cat:computer');
  const catAppliance = seedId('cat:appliance');
  const catClothing = seedId('cat:clothing');
  const catFood = seedId('cat:food');
  const catBeauty = seedId('cat:beauty');
  const catBooks = seedId('cat:books');
  const catSports = seedId('cat:sports');
  const catHome = seedId('cat:home');
  const catBaby = seedId('cat:baby');

  // 二级分类 ID（确定性，与 seed-prod.ts 一致）
  const catPhone = seedId('cat:phones');
  const catEarphone = seedId('cat:earphones');
  const catSmartWatch = seedId('cat:smart-watches');
  const catLaptop = seedId('cat:laptops');
  const catTablet = seedId('cat:tablets');
  const catKeyboard = seedId('cat:keyboards');
  const catBigAppliance = seedId('cat:big-appliance');
  const catSmallAppliance = seedId('cat:small-appliance');
  const catKitchen = seedId('cat:kitchen-appliance');
  const catMenswear = seedId('cat:menswear');
  const catWomenswear = seedId('cat:womenswear');
  const catShoes = seedId('cat:shoes');
  const catSnacks = seedId('cat:snacks');
  const catDrinks = seedId('cat:drinks');
  const catFresh = seedId('cat:fresh');
  const catSkincare = seedId('cat:skincare');
  const catMakeup = seedId('cat:makeup');
  const catWashCare = seedId('cat:wash-care');
  const catLiterature = seedId('cat:literature');
  const catEducation = seedId('cat:education');
  const catComic = seedId('cat:comic');
  const catFitness = seedId('cat:fitness');
  const catOutdoor = seedId('cat:outdoor');
  const catSportswear = seedId('cat:sportswear');
  const catFurniture = seedId('cat:furniture');
  const catBedding = seedId('cat:bedding');
  const catStorage = seedId('cat:storage');
  const catMilkPowder = seedId('cat:milk-powder');
  const catDiaper = seedId('cat:diapers');
  const catToys = seedId('cat:toys');

  await db.insert(categories).values([
    // 一级分类
    { id: catDigital, name: '手机数码', slug: 'digital', iconUrl: 'https://picsum.photos/seed/digital/800/800', sortOrder: 1 },
    { id: catComputer, name: '电脑办公', slug: 'computer', iconUrl: 'https://picsum.photos/seed/pc/800/800', sortOrder: 2 },
    { id: catAppliance, name: '家用电器', slug: 'appliance', iconUrl: 'https://picsum.photos/seed/home/800/800', sortOrder: 3 },
    { id: catClothing, name: '服饰鞋包', slug: 'clothing', iconUrl: 'https://picsum.photos/seed/fashion/800/800', sortOrder: 4 },
    { id: catFood, name: '食品生鲜', slug: 'food', iconUrl: 'https://picsum.photos/seed/food/800/800', sortOrder: 5 },
    { id: catBeauty, name: '美妆个护', slug: 'beauty', iconUrl: 'https://picsum.photos/seed/beauty/800/800', sortOrder: 6 },
    { id: catBooks, name: '图书音像', slug: 'books', iconUrl: 'https://picsum.photos/seed/books/800/800', sortOrder: 7 },
    { id: catSports, name: '运动户外', slug: 'sports', iconUrl: 'https://picsum.photos/seed/sports/800/800', sortOrder: 8 },
    { id: catHome, name: '家居家装', slug: 'home', iconUrl: 'https://picsum.photos/seed/home-1/800/800', sortOrder: 9 },
    { id: catBaby, name: '母婴玩具', slug: 'baby', iconUrl: 'https://picsum.photos/seed/baby/800/800', sortOrder: 10 },
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
    const prodId = seedId('prod:' + opts.slug);

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
        id: seedId('img:' + opts.slug + ':' + i),
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
      const skuId = seedId('sku:' + s.code);
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
    imageUrls: ['https://picsum.photos/seed/iphone-13-pro/800/800', 'https://picsum.photos/seed/iphone-13-pro-1/800/800', 'https://picsum.photos/seed/iphone-13-pro-2/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/samsung-galaxy-s8/800/800', 'https://picsum.photos/seed/samsung-galaxy-s8-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/oppo-f19-pro-plus/800/800', 'https://picsum.photos/seed/realme-xt/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/apple-airpods/800/800', 'https://picsum.photos/seed/apple-airpods-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/apple-airpods-max-silver/800/800', 'https://picsum.photos/seed/beats-flex-wireless-earphones/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/apple-watch-series-4-gold/800/800', 'https://picsum.photos/seed/apple-watch-series-4-gold-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/apple-macbook-pro-14-inch-space-grey/800/800', 'https://picsum.photos/seed/apple-macbook-pro-14-inch-space-grey-1/800/800', 'https://picsum.photos/seed/apple-macbook-pro-14-inch-space-grey-2/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/lenovo-yoga-920/800/800', 'https://picsum.photos/seed/lenovo-yoga-920-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/ipad-mini-2021-starlight/800/800', 'https://picsum.photos/seed/ipad-mini-2021-starlight-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/samsung-galaxy-tab-s8-plus-grey/800/800', 'https://picsum.photos/seed/samsung-galaxy-tab-s8-plus-grey-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/hhkb-keyboard/800/800', 'https://picsum.photos/seed/hhkb-type-s/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/dyson-v15/800/800', 'https://picsum.photos/seed/dyson-detect/800/800', 'https://picsum.photos/seed/dyson-hepa/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/haier-fridge/800/800', 'https://picsum.photos/seed/haier-510l/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/electric-stove/800/800', 'https://picsum.photos/seed/silver-pot-with-glass-cap/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/man-short-sleeve-shirt/800/800', 'https://picsum.photos/seed/man-short-sleeve-shirt-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/sports-sneakers-off-white-red/800/800', 'https://picsum.photos/seed/sports-sneakers-off-white-red-1/800/800', 'https://picsum.photos/seed/sports-sneakers-off-white-red-2/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/gray-dress/800/800', 'https://picsum.photos/seed/gray-dress-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/blue-black-check-shirt/800/800', 'https://picsum.photos/seed/blue-black-check-shirt-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/mulberry/800/800', 'https://picsum.photos/seed/honey-jar/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/water/800/800', 'https://picsum.photos/seed/juice/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/nescafe-coffee/800/800', 'https://picsum.photos/seed/ice-cream/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/strawberry/800/800', 'https://picsum.photos/seed/kiwi/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/olay-ultra-moisture-shea-butter-body-wash/800/800', 'https://picsum.photos/seed/olay-ultra-moisture-shea-butter-body-wash-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/red-lipstick/800/800', 'https://picsum.photos/seed/eyeshadow-palette-with-mirror/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/vaseline-men-body-and-face-lotion/800/800', 'https://picsum.photos/seed/attitude-super-leaves-hand-soap/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/three-body/800/800', 'https://picsum.photos/seed/dark-forest/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/javascript/800/800', 'https://picsum.photos/seed/es6/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/one-piece/800/800', 'https://picsum.photos/seed/luffy/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/keep-bike/800/800', 'https://picsum.photos/seed/smart-bike/800/800', 'https://picsum.photos/seed/ai-coach/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/gore-tex/800/800', 'https://picsum.photos/seed/tnf-jacket/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/nike-air-jordan-1-red-and-black/800/800', 'https://picsum.photos/seed/nike-air-jordan-1-red-and-black-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/bedside-table-african-cherry/800/800', 'https://picsum.photos/seed/bedside-table-african-cherry-1/800/800', 'https://picsum.photos/seed/bedside-table-african-cherry-2/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/annibale-colombo-bed/800/800', 'https://picsum.photos/seed/annibale-colombo-bed-1/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/house-showpiece-plant/800/800', 'https://picsum.photos/seed/plant-pot/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/milk/800/800', 'https://picsum.photos/seed/protein-powder/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/merries-l/800/800', 'https://picsum.photos/seed/merries-xl/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/lego-bugatti/800/800', 'https://picsum.photos/seed/lego-42151/800/800', 'https://picsum.photos/seed/905-pieces/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/b.duck-scooter/800/800', 'https://picsum.photos/seed/kids-scooter/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/samsung-galaxy-s10/800/800', 'https://picsum.photos/seed/samsung-galaxy-s10-1/800/800', 'https://picsum.photos/seed/samsung-galaxy-s10-2/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/dyson-hd15/800/800', 'https://picsum.photos/seed/dyson-supersonic/800/800'],
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
    imageUrls: ['https://picsum.photos/seed/dress-pea/800/800', 'https://picsum.photos/seed/dress-pea-1/800/800', 'https://picsum.photos/seed/dress-pea-2/800/800'],
    skuList: [
      { code: 'FD-FV-S-FLR', price: '299.00', comparePrice: '459.00', stock: 180, attributes: { size: 'S', color: '碎花白' } },
      { code: 'FD-FV-M-FLR', price: '299.00', comparePrice: '459.00', stock: 220, attributes: { size: 'M', color: '碎花白' } },
      { code: 'FD-FV-L-FLR', price: '299.00', comparePrice: '459.00', stock: 150, attributes: { size: 'L', color: '碎花白' } },
    ],
  });

  // ══════════════════════════════════════════════════════════════
  // 新增商品 — 补充各分类至 3~4 个
  // ══════════════════════════════════════════════════════════════

  // ── 手机数码 · 耳机 ──
  await insertProduct({
    title: '华为 FreeBuds Pro 3 真无线耳机',
    slug: 'huawei-freebuds-pro-3',
    description: '华为 FreeBuds Pro 3，星闪连接，智慧降噪3.0，LDAC高清音质',
    brand: '华为',
    categoryId: catEarphone,
    minPrice: '1199.00', maxPrice: '1199.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/amazon-echo-dot-5th-generation/800/800', 'https://picsum.photos/seed/amazon-echo-dot-5th-generation/800/800'],
    skuList: [
      { code: 'HW-FBP3-WHT', price: '1199.00', comparePrice: '1499.00', stock: 200, attributes: { color: '陶瓷白' } },
      { code: 'HW-FBP3-GRN', price: '1199.00', comparePrice: '1499.00', stock: 150, attributes: { color: '雅川青' } },
    ],
  });

  // ── 手机数码 · 智能手表 ──
  await insertProduct({
    title: '华为 Watch GT 4 46mm',
    slug: 'huawei-watch-gt4-46',
    description: '华为 Watch GT 4，八角形设计，14天超长续航，心率血氧监测',
    brand: '华为',
    categoryId: catSmartWatch,
    minPrice: '1488.00', maxPrice: '1688.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/brown-leather-belt-watch/800/800', 'https://picsum.photos/seed/brown-leather-belt-watch-1/800/800'],
    skuList: [
      { code: 'HWGT4-46-BLK', price: '1488.00', comparePrice: '1688.00', stock: 150, attributes: { size: '46mm', band: '黑色氟橡胶' } },
      { code: 'HWGT4-46-BRN', price: '1688.00', comparePrice: '1888.00', stock: 100, attributes: { size: '46mm', band: '棕色真皮' } },
    ],
  });

  await insertProduct({
    title: 'Samsung Galaxy Watch6 Classic',
    slug: 'samsung-galaxy-watch6-classic',
    description: '三星 Galaxy Watch6 Classic，旋转表圈，BioActive传感器，WearOS',
    brand: 'Samsung',
    categoryId: catSmartWatch,
    minPrice: '2199.00', maxPrice: '2799.00',
    totalSales: randInt(500, 2000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/long-moonlight-necklace/800/800', 'https://picsum.photos/seed/round-silver-analog-watch/800/800'],
    skuList: [
      { code: 'GW6C-43-SLV', price: '2199.00', comparePrice: '2599.00', stock: 100, attributes: { size: '43mm', color: '银色' } },
      { code: 'GW6C-47-BLK', price: '2799.00', comparePrice: '3199.00', stock: 80, attributes: { size: '47mm', color: '黑色' } },
    ],
  });

  // ── 电脑办公 · 笔记本 ──
  await insertProduct({
    title: '华硕 ROG 幻16 游戏本',
    slug: 'asus-rog-zephyrus-g16',
    description: '华硕 ROG 幻16，i9-13900H + RTX4070，16英寸2K 240Hz电竞屏',
    brand: 'ASUS',
    categoryId: catLaptop,
    minPrice: '11999.00', maxPrice: '14999.00',
    totalSales: randInt(500, 2000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/asus-zenbook-pro-dual-screen-laptop/800/800', 'https://picsum.photos/seed/asus-zenbook-pro-dual-screen-laptop-1/800/800', 'https://picsum.photos/seed/asus-zenbook-pro-dual-screen-laptop-2/800/800'],
    skuList: [
      { code: 'ROG-G16-4060', price: '11999.00', comparePrice: '13499.00', stock: 80, attributes: { gpu: 'RTX4060', memory: '16GB', storage: '512GB' } },
      { code: 'ROG-G16-4070', price: '14999.00', comparePrice: '16999.00', stock: 50, lowStock: 10, attributes: { gpu: 'RTX4070', memory: '32GB', storage: '1TB' } },
    ],
  });

  // ── 电脑办公 · 平板 ──
  await insertProduct({
    title: 'Samsung Galaxy Tab S9 Ultra',
    slug: 'samsung-galaxy-tab-s9-ultra',
    description: '三星 Galaxy Tab S9 Ultra，14.6英寸 AMOLED，骁龙8 Gen2，S Pen',
    brand: 'Samsung',
    categoryId: catTablet,
    minPrice: '8999.00', maxPrice: '10999.00',
    totalSales: randInt(300, 1500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/samsung-galaxy-tab-s7-plus-midnight-black/800/800', 'https://picsum.photos/seed/samsung-galaxy-tab-s7-plus-midnight-black/800/800'],
    skuList: [
      { code: 'TABS9U-256-GRY', price: '8999.00', comparePrice: '9999.00', stock: 60, attributes: { storage: '256GB', color: '石墨灰' } },
      { code: 'TABS9U-512-BEG', price: '10999.00', comparePrice: '11999.00', stock: 40, lowStock: 10, attributes: { storage: '512GB', color: '奶油白' } },
    ],
  });

  // ── 电脑办公 · 键盘鼠标 ──
  await insertProduct({
    title: '罗技 MX Keys S 无线键盘',
    slug: 'logitech-mx-keys-s',
    description: '罗技 MX Keys S，智能背光，多设备切换，低噪静音输入',
    brand: 'Logitech',
    categoryId: catKeyboard,
    minPrice: '699.00', maxPrice: '699.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/mx-keys-s/800/800', 'https://picsum.photos/seed/logitech-mx/800/800'],
    skuList: [
      { code: 'MXKEYS-S-BLK', price: '699.00', comparePrice: '849.00', stock: 200, attributes: { color: '石墨', layout: '全尺寸' } },
    ],
  });

  await insertProduct({
    title: 'Keychron K3 Pro 超薄机械键盘',
    slug: 'keychron-k3-pro',
    description: 'Keychron K3 Pro，75%布局，Gateron矮轴，蓝牙/有线双模',
    brand: 'Keychron',
    categoryId: catKeyboard,
    minPrice: '549.00', maxPrice: '549.00',
    totalSales: randInt(500, 2000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/k3-pro/800/800', 'https://picsum.photos/seed/keychron/800/800'],
    skuList: [
      { code: 'KC-K3P-RED', price: '549.00', comparePrice: '649.00', stock: 120, attributes: { switch: '红轴', backlight: 'RGB' } },
      { code: 'KC-K3P-BRN', price: '549.00', comparePrice: '649.00', stock: 100, attributes: { switch: '茶轴', backlight: 'RGB' } },
    ],
  });

  // ── 家用电器 · 冰箱洗衣机 ──
  await insertProduct({
    title: '西门子 10公斤滚筒洗衣机 WG54B2X00W',
    slug: 'siemens-washer-wg54b2',
    description: '西门子10kg滚筒洗衣机，1400转变频，智能除渍，15分钟快洗',
    brand: '西门子',
    categoryId: catBigAppliance,
    minPrice: '4999.00', maxPrice: '4999.00',
    totalSales: randInt(500, 1500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/siemens-washer/800/800', 'https://picsum.photos/seed/10kg-drum/800/800'],
    skuList: [
      { code: 'SIEM-WG54B-WHT', price: '4999.00', comparePrice: '5999.00', stock: 40, lowStock: 10, attributes: { color: '白色', capacity: '10kg' } },
    ],
  });

  await insertProduct({
    title: '美的 1.5匹一级变频空调 KFR-35GW',
    slug: 'midea-ac-kfr35gw',
    description: '美的新一级能效变频空调，急速冷暖，智能WiFi控制，静音运行',
    brand: '美的',
    categoryId: catBigAppliance,
    minPrice: '2699.00', maxPrice: '2699.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/midea-ac/800/800', 'https://picsum.photos/seed/1.5p-ac/800/800'],
    skuList: [
      { code: 'MIDEA-AC-35-WHT', price: '2699.00', comparePrice: '3299.00', stock: 80, attributes: { power: '1.5匹', energy: '一级能效' } },
    ],
  });

  // ── 家用电器 · 小家电 ──
  await insertProduct({
    title: '石头 G20 扫拖机器人',
    slug: 'roborock-g20',
    description: '石头 G20，全能基站，自清洁拖布，6000Pa大吸力，LDS激光导航',
    brand: '石头',
    categoryId: catSmallAppliance,
    minPrice: '3999.00', maxPrice: '3999.00',
    totalSales: randInt(800, 2500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/roborock-g20/800/800', 'https://picsum.photos/seed/robot-vacuum/800/800'],
    skuList: [
      { code: 'ROBO-G20-WHT', price: '3999.00', comparePrice: '4799.00', stock: 60, attributes: { color: '曙光白' } },
    ],
  });

  // ── 家用电器 · 厨房电器 ──
  await insertProduct({
    title: '九阳 破壁豆浆机 Y1 Plus',
    slug: 'joyoung-y1-plus',
    description: '九阳破壁豆浆机，自清洗免手洗，不用泡豆，8大功能',
    brand: '九阳',
    categoryId: catKitchen,
    minPrice: '1299.00', maxPrice: '1299.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/electric-stove-1/800/800', 'https://picsum.photos/seed/electric-stove-2/800/800'],
    skuList: [
      { code: 'JY-Y1P-WHT', price: '1299.00', comparePrice: '1599.00', stock: 100, attributes: { color: '白色', capacity: '1.2L' } },
    ],
  });

  await insertProduct({
    title: '松下 变频微波炉 NN-DS59MB',
    slug: 'panasonic-microwave-ds59',
    description: '松下变频微波炉，27L容量，蒸烤炸一体，一级能效',
    brand: '松下',
    categoryId: catKitchen,
    minPrice: '1699.00', maxPrice: '1699.00',
    totalSales: randInt(500, 2000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/silver-pot-with-glass-cap/800/800', 'https://picsum.photos/seed/silver-pot-with-glass-cap/800/800'],
    skuList: [
      { code: 'PANA-MW-59-BLK', price: '1699.00', comparePrice: '1999.00', stock: 60, attributes: { color: '黑色', capacity: '27L' } },
    ],
  });

  // ── 服饰鞋包 · 男装 ──
  await insertProduct({
    title: 'Ralph Lauren 经典Polo衫 男款',
    slug: 'ralph-lauren-polo-shirt-men',
    description: 'Ralph Lauren 经典小马标Polo衫，网眼棉面料，休闲商务两穿',
    brand: 'Ralph Lauren',
    categoryId: catMenswear,
    minPrice: '799.00', maxPrice: '799.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/man-plaid-shirt/800/800', 'https://picsum.photos/seed/man-plaid-shirt-1/800/800'],
    skuList: [
      { code: 'RL-POLO-M-NVY', price: '799.00', comparePrice: '990.00', stock: 150, attributes: { size: 'M', color: '藏青' } },
      { code: 'RL-POLO-L-WHT', price: '799.00', comparePrice: '990.00', stock: 120, attributes: { size: 'L', color: '白色' } },
      { code: 'RL-POLO-XL-RED', price: '799.00', comparePrice: '990.00', stock: 100, attributes: { size: 'XL', color: '红色' } },
    ],
  });

  // ── 服饰鞋包 · 女装 ──
  await insertProduct({
    title: '太平鸟 女式西装外套 通勤款',
    slug: 'peacebird-blazer-women',
    description: '太平鸟西装外套，垂坠感面料，修身剪裁，通勤穿搭必备',
    brand: '太平鸟',
    categoryId: catWomenswear,
    minPrice: '599.00', maxPrice: '599.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/womans-black-top/800/800', 'https://picsum.photos/seed/womans-black-top/800/800'],
    skuList: [
      { code: 'PB-BLZ-W-S-BLK', price: '599.00', comparePrice: '799.00', stock: 120, attributes: { size: 'S', color: '黑色' } },
      { code: 'PB-BLZ-W-M-KHK', price: '599.00', comparePrice: '799.00', stock: 150, attributes: { size: 'M', color: '卡其' } },
      { code: 'PB-BLZ-W-L-BLK', price: '599.00', comparePrice: '799.00', stock: 100, attributes: { size: 'L', color: '黑色' } },
    ],
  });

  // ── 服饰鞋包 · 鞋靴 ──
  await insertProduct({
    title: 'New Balance 574 经典复古跑鞋',
    slug: 'new-balance-574-classic',
    description: 'New Balance 574，经典复古鞋型，ENCAP中底缓震，百搭不过时',
    brand: 'New Balance',
    categoryId: catShoes,
    minPrice: '769.00', maxPrice: '769.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/nike-baseball-cleats/800/800', 'https://picsum.photos/seed/nike-baseball-cleats-1/800/800'],
    skuList: [
      { code: 'NB574-40-GRY', price: '769.00', comparePrice: '899.00', stock: 120, attributes: { size: '40', color: '元祖灰' } },
      { code: 'NB574-42-GRY', price: '769.00', comparePrice: '899.00', stock: 150, attributes: { size: '42', color: '元祖灰' } },
      { code: 'NB574-43-NVY', price: '769.00', comparePrice: '899.00', stock: 100, attributes: { size: '43', color: '藏青' } },
    ],
  });

  await insertProduct({
    title: '匡威 Chuck Taylor All Star 经典帆布鞋',
    slug: 'converse-chuck-taylor-classic',
    description: '匡威 Chuck Taylor All Star，经典高帮帆布鞋，时尚百搭',
    brand: 'Converse',
    categoryId: catShoes,
    minPrice: '499.00', maxPrice: '499.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/lace-up-boots/800/800', 'https://picsum.photos/seed/lace-up-boots/800/800'],
    skuList: [
      { code: 'CVS-CT-38-BLK', price: '499.00', comparePrice: '599.00', stock: 200, attributes: { size: '38', color: '黑色' } },
      { code: 'CVS-CT-40-WHT', price: '499.00', comparePrice: '599.00', stock: 250, attributes: { size: '40', color: '白色' } },
      { code: 'CVS-CT-42-RED', price: '499.00', comparePrice: '599.00', stock: 180, attributes: { size: '42', color: '红色' } },
    ],
  });

  // ── 食品生鲜 · 零食 ──
  await insertProduct({
    title: '良品铺子 鸭脖鸭锁骨 卤味零食大礼包',
    slug: 'bestore-duck-neck-gift-box',
    description: '良品铺子卤味零食大礼包，鸭脖鸭锁骨鸭翅组合，麻辣鲜香',
    brand: '良品铺子',
    categoryId: catSnacks,
    minPrice: '59.90', maxPrice: '99.90',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/beef-steak/800/800', 'https://picsum.photos/seed/chicken-meat/800/800'],
    skuList: [
      { code: 'LPPZ-DUCK-S', price: '59.90', comparePrice: '79.90', stock: 300, attributes: { spec: '小份装 400g' } },
      { code: 'LPPZ-DUCK-L', price: '99.90', comparePrice: '129.90', stock: 200, attributes: { spec: '大礼包 800g' } },
    ],
  });

  await insertProduct({
    title: '百草味 芒果干 蜜饯果脯 500g',
    slug: 'baicaowei-dried-mango-500',
    description: '百草味芒果干，精选泰国芒果，软糯香甜，独立小包装',
    brand: '百草味',
    categoryId: catSnacks,
    minPrice: '29.90', maxPrice: '49.90',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/apple/800/800', 'https://picsum.photos/seed/cat-food/800/800'],
    skuList: [
      { code: 'BCW-MANGO-250', price: '29.90', comparePrice: '39.90', stock: 400, attributes: { spec: '250g' } },
      { code: 'BCW-MANGO-500', price: '49.90', comparePrice: '69.90', stock: 300, attributes: { spec: '500g' } },
    ],
  });

  // ── 食品生鲜 · 饮料 ──
  await insertProduct({
    title: '元气森林 苏打气泡水 白桃味 480ml×15瓶',
    slug: 'genki-forest-sparkling-peach-15',
    description: '元气森林气泡水，0糖0脂0卡，白桃风味，清爽畅饮',
    brand: '元气森林',
    categoryId: catDrinks,
    minPrice: '59.90', maxPrice: '59.90',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/juice/800/800', 'https://picsum.photos/seed/water/800/800'],
    skuList: [
      { code: 'GKF-PEACH-15', price: '59.90', comparePrice: '74.90', stock: 400, attributes: { flavor: '白桃味', spec: '480ml×15瓶' } },
    ],
  });

  // ── 食品生鲜 · 生鲜 ──
  await insertProduct({
    title: '丹东99草莓 新鲜水果 3斤装',
    slug: 'dandong-strawberry-3lb',
    description: '丹东99红颜草莓，当季新鲜采摘，个大饱满，香甜多汁',
    brand: '鲜果时光',
    categoryId: catFresh,
    minPrice: '89.00', maxPrice: '89.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/strawberry/800/800', 'https://picsum.photos/seed/strawberry/800/800'],
    skuList: [
      { code: 'DD99-SB-3LB', price: '89.00', comparePrice: '119.00', stock: 100, lowStock: 15, attributes: { spec: '3斤装', grade: '精选大果' } },
    ],
  });

  await insertProduct({
    title: '厄瓜多尔白虾 冷冻大虾 净重4斤',
    slug: 'ecuador-white-shrimp-4lb',
    description: '厄瓜多尔进口白虾，30-40只/斤，肉质紧实弹牙，急冻锁鲜',
    brand: '海鲜汇',
    categoryId: catFresh,
    minPrice: '149.00', maxPrice: '149.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/salmon/800/800', 'https://picsum.photos/seed/fish-steak/800/800'],
    skuList: [
      { code: 'EC-SHRIMP-4LB', price: '149.00', comparePrice: '199.00', stock: 80, lowStock: 10, attributes: { spec: '净重4斤', size: '30-40只/斤' } },
    ],
  });

  // ── 美妆个护 · 护肤 ──
  await insertProduct({
    title: '兰蔻 小黑瓶精华肌底液 100ml',
    slug: 'lancome-advanced-genifique-100',
    description: '兰蔻小黑瓶，微生态护肤，修护肌肤屏障，焕亮好气色',
    brand: '兰蔻',
    categoryId: catSkincare,
    minPrice: '1080.00', maxPrice: '1080.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/dove-body-care-nourishing-body-wash/800/800', 'https://picsum.photos/seed/hemani-tea-tree-oil/800/800'],
    skuList: [
      { code: 'LC-AGF-50', price: '760.00', comparePrice: '890.00', stock: 200, attributes: { spec: '50ml' } },
      { code: 'LC-AGF-100', price: '1080.00', comparePrice: '1260.00', stock: 150, attributes: { spec: '100ml' } },
    ],
  });

  await insertProduct({
    title: '雅诗兰黛 小棕瓶眼霜 15ml',
    slug: 'estee-lauder-eye-cream-15',
    description: '雅诗兰黛小棕瓶眼霜，淡化细纹，提亮眼周，抗初老必备',
    brand: '雅诗兰黛',
    categoryId: catSkincare,
    minPrice: '520.00', maxPrice: '520.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/elf-skin-super-hydrate-moisturizer/800/800', 'https://picsum.photos/seed/elf-skin-super-hydrate-moisturizer/800/800'],
    skuList: [
      { code: 'EL-ANR-EYE-15', price: '520.00', comparePrice: '620.00', stock: 250, attributes: { spec: '15ml' } },
    ],
  });

  // ── 美妆个护 · 彩妆 ──
  await insertProduct({
    title: '完美日记 动物眼影盘 小猫盘',
    slug: 'perfect-diary-cat-eyeshadow',
    description: '完美日记动物系列眼影盘，12色搭配，粉质细腻，持妆不飞粉',
    brand: '完美日记',
    categoryId: catMakeup,
    minPrice: '89.90', maxPrice: '89.90',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/eyeshadow-palette-with-mirror/800/800', 'https://picsum.photos/seed/makeup-remover/800/800'],
    skuList: [
      { code: 'PD-CAT-12', price: '89.90', comparePrice: '129.90', stock: 300, attributes: { palette: '小猫盘', colors: '12色' } },
    ],
  });

  await insertProduct({
    title: '花西子 空气蜜粉 定妆散粉',
    slug: 'florasis-air-powder',
    description: '花西子空气蜜粉，超细粉质，控油定妆，轻薄透气如无物',
    brand: '花西子',
    categoryId: catMakeup,
    minPrice: '149.00', maxPrice: '149.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/powder-canister/800/800', 'https://picsum.photos/seed/powder-canister/800/800'],
    skuList: [
      { code: 'FLR-AP-01', price: '149.00', comparePrice: '199.00', stock: 250, attributes: { shade: '01 自然色' } },
      { code: 'FLR-AP-02', price: '149.00', comparePrice: '199.00', stock: 200, attributes: { shade: '02 嫩肤色' } },
    ],
  });

  // ── 美妆个护 · 洗护 ──
  await insertProduct({
    title: '潘婷 3分钟奇迹发膜 护发素 270ml',
    slug: 'pantene-3min-miracle-conditioner',
    description: '潘婷3分钟奇迹发膜，氨基酸修护，丝滑顺发，深层滋养',
    brand: '潘婷',
    categoryId: catWashCare,
    minPrice: '39.90', maxPrice: '39.90',
    totalSales: randInt(2500, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/vaseline-men-body-and-face-lotion-1/800/800', 'https://picsum.photos/seed/attitude-super-leaves-hand-soap-1/800/800'],
    skuList: [
      { code: 'PANT-3MM-270', price: '39.90', comparePrice: '59.90', stock: 400, attributes: { spec: '270ml', type: '丝质顺滑型' } },
    ],
  });

  await insertProduct({
    title: '舒肤佳 纯白清香沐浴露 1L',
    slug: 'safeguard-body-wash-1l',
    description: '舒肤佳沐浴露，12小时长效抑菌，温和配方，全家可用',
    brand: '舒肤佳',
    categoryId: catWashCare,
    minPrice: '39.90', maxPrice: '39.90',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/neutrogena-norwegian-formula-hand-cream/800/800', 'https://picsum.photos/seed/neutrogena-norwegian-formula-hand-cream/800/800'],
    skuList: [
      { code: 'SFJ-BW-1L', price: '39.90', comparePrice: '59.90', stock: 500, attributes: { spec: '1L', fragrance: '纯白清香' } },
    ],
  });

  // ── 图书音像 · 文学 ──
  await insertProduct({
    title: '活着（余华）',
    slug: 'to-live-yu-hua',
    description: '余华代表作，讲述人在苦难中的坚韧与温情，销量超2000万册',
    brand: '作家出版社',
    categoryId: catLiterature,
    minPrice: '29.00', maxPrice: '29.00',
    totalSales: randInt(4000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/to-live/800/800', 'https://picsum.photos/seed/yu-hua/800/800'],
    skuList: [
      { code: 'HUOZHE-PB', price: '29.00', comparePrice: '45.00', stock: 500, attributes: { format: '平装', version: '最新版' } },
    ],
  });

  await insertProduct({
    title: '百年孤独（加西亚·马尔克斯）',
    slug: 'one-hundred-years-of-solitude',
    description: '马尔克斯代表作，魔幻现实主义文学巅峰，诺贝尔文学奖作品',
    brand: '南海出版公司',
    categoryId: catLiterature,
    minPrice: '55.00', maxPrice: '55.00',
    totalSales: randInt(2000, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/solitude/800/800', 'https://picsum.photos/seed/marquez/800/800'],
    skuList: [
      { code: 'BNGD-50TH', price: '55.00', comparePrice: '69.80', stock: 400, attributes: { format: '精装', version: '50周年纪念版' } },
    ],
  });

  // ── 图书音像 · 教育 ──
  await insertProduct({
    title: 'Python编程 从入门到实践 第3版',
    slug: 'python-crash-course-3rd',
    description: 'Python入门经典教材，项目驱动式学习，适合零基础读者',
    brand: '人民邮电出版社',
    categoryId: catEducation,
    minPrice: '79.80', maxPrice: '79.80',
    totalSales: randInt(2000, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/python/800/800', 'https://picsum.photos/seed/crash-course/800/800'],
    skuList: [
      { code: 'PYCC-3RD', price: '79.80', comparePrice: '109.80', stock: 300, attributes: { format: '纸质书', edition: '第3版' } },
    ],
  });

  await insertProduct({
    title: '高等数学（同济第七版）上下册',
    slug: 'advanced-math-tongji-7th',
    description: '同济大学数学系经典教材，高等院校通用，工科学生必备',
    brand: '高等教育出版社',
    categoryId: catEducation,
    minPrice: '68.00', maxPrice: '68.00',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/math/800/800', 'https://picsum.photos/seed/calculus/800/800'],
    skuList: [
      { code: 'GDSX-7-SET', price: '68.00', comparePrice: '96.60', stock: 500, attributes: { format: '纸质书', spec: '上下册套装' } },
    ],
  });

  // ── 图书音像 · 漫画 ──
  await insertProduct({
    title: '鬼灭之刃 漫画全套 1-23卷',
    slug: 'demon-slayer-manga-1-23',
    description: '吾峠呼世晴著，累计发行超1.5亿册，热血战斗漫画',
    brand: '浙江人民美术出版社',
    categoryId: catComic,
    minPrice: '6.90', maxPrice: '299.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/demon-slayer/800/800', 'https://picsum.photos/seed/tanjiro/800/800'],
    skuList: [
      { code: 'GMMZR-SINGLE', price: '6.90', comparePrice: '9.90', stock: 500, attributes: { spec: '单册', format: '漫画' } },
      { code: 'GMMZR-BOX-1-23', price: '299.00', comparePrice: '399.00', stock: 80, lowStock: 10, attributes: { spec: '全套1-23卷', format: '漫画' } },
    ],
  });

  await insertProduct({
    title: '进击的巨人 漫画全套 1-34卷',
    slug: 'attack-on-titan-manga-1-34',
    description: '谏山创著，暗黑奇幻巨作，揭开墙外世界的真相',
    brand: '新星出版社',
    categoryId: catComic,
    minPrice: '6.90', maxPrice: '399.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/aot/800/800', 'https://picsum.photos/seed/titan/800/800'],
    skuList: [
      { code: 'AOT-SINGLE', price: '6.90', comparePrice: '9.90', stock: 500, attributes: { spec: '单册', format: '漫画' } },
      { code: 'AOT-BOX-1-34', price: '399.00', comparePrice: '499.00', stock: 50, lowStock: 10, attributes: { spec: '全套1-34卷', format: '漫画' } },
    ],
  });

  // ── 运动户外 · 健身器材 ──
  await insertProduct({
    title: '小莫 包胶哑铃 可调节 20kg一对',
    slug: 'xiaomo-adjustable-dumbbell-20kg',
    description: '小莫可调节哑铃，环保包胶，防滑手柄，10档重量自由切换',
    brand: '小莫',
    categoryId: catFitness,
    minPrice: '299.00', maxPrice: '499.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/football/800/800', 'https://picsum.photos/seed/metal-bat/800/800'],
    skuList: [
      { code: 'XM-DB-10KG', price: '299.00', comparePrice: '399.00', stock: 150, attributes: { weight: '10kg×2', material: '包胶' } },
      { code: 'XM-DB-20KG', price: '499.00', comparePrice: '599.00', stock: 100, attributes: { weight: '20kg×2', material: '包胶' } },
    ],
  });

  await insertProduct({
    title: '悦步 瑜伽垫 加宽加厚 185×80cm',
    slug: 'yuebu-yoga-mat-185x80',
    description: '悦步TPE瑜伽垫，双面防滑，高回弹缓震，环保无味',
    brand: '悦步',
    categoryId: catFitness,
    minPrice: '89.00', maxPrice: '129.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/tennis-ball/800/800', 'https://picsum.photos/seed/cricket-helmet/800/800'],
    skuList: [
      { code: 'YB-YOGA-6MM', price: '89.00', comparePrice: '119.00', stock: 300, attributes: { thickness: '6mm', color: '藕粉' } },
      { code: 'YB-YOGA-8MM', price: '129.00', comparePrice: '159.00', stock: 200, attributes: { thickness: '8mm', color: '深紫' } },
    ],
  });

  // ── 运动户外 · 户外装备 ──
  await insertProduct({
    title: '始祖鸟 Mantis 26 户外双肩包',
    slug: 'arcteryx-mantis-26-backpack',
    description: "Arc'teryx Mantis 26L，城市户外两用，轻量耐磨，多隔层收纳",
    brand: "Arc'teryx",
    categoryId: catOutdoor,
    minPrice: '1350.00', maxPrice: '1350.00',
    totalSales: randInt(500, 2000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/women-handbag-black/800/800', 'https://picsum.photos/seed/women-handbag-black-1/800/800'],
    skuList: [
      { code: 'ARC-M26-BLK', price: '1350.00', comparePrice: '1600.00', stock: 80, lowStock: 10, attributes: { color: '黑色', capacity: '26L' } },
    ],
  });

  await insertProduct({
    title: 'Columbia 哥伦比亚 防水冲锋裤 男款',
    slug: 'columbia-waterproof-pants-men',
    description: 'Columbia Omni-Tech 防水冲锋裤，三层压胶，透气速干，登山徒步',
    brand: 'Columbia',
    categoryId: catOutdoor,
    minPrice: '799.00', maxPrice: '799.00',
    totalSales: randInt(500, 2000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/columbia-pants/800/800', 'https://picsum.photos/seed/waterproof/800/800'],
    skuList: [
      { code: 'COL-WP-M-M', price: '799.00', comparePrice: '999.00', stock: 100, attributes: { size: 'M', color: '黑色' } },
      { code: 'COL-WP-M-L', price: '799.00', comparePrice: '999.00', stock: 120, attributes: { size: 'L', color: '黑色' } },
      { code: 'COL-WP-M-XL', price: '799.00', comparePrice: '999.00', stock: 80, attributes: { size: 'XL', color: '军绿' } },
    ],
  });

  // ── 运动户外 · 运动服饰 ──
  await insertProduct({
    title: 'Under Armour 紧身压缩衣 男款',
    slug: 'under-armour-compression-shirt',
    description: 'Under Armour HeatGear 压缩衣，四向弹力，速干排汗，贴合运动',
    brand: 'Under Armour',
    categoryId: catSportswear,
    minPrice: '299.00', maxPrice: '299.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/man-transition-jacket/800/800', 'https://picsum.photos/seed/man-transition-jacket/800/800'],
    skuList: [
      { code: 'UA-CMP-M-BLK', price: '299.00', comparePrice: '399.00', stock: 200, attributes: { size: 'M', color: '黑色' } },
      { code: 'UA-CMP-L-BLK', price: '299.00', comparePrice: '399.00', stock: 250, attributes: { size: 'L', color: '黑色' } },
      { code: 'UA-CMP-XL-NVY', price: '299.00', comparePrice: '399.00', stock: 150, attributes: { size: 'XL', color: '藏青' } },
    ],
  });

  await insertProduct({
    title: '安踏 KT8 汤普森篮球鞋',
    slug: 'anta-kt8-basketball-shoes',
    description: '安踏 KT8 克莱·汤普森签名篮球鞋，氮科技中底，实战缓震',
    brand: '安踏',
    categoryId: catSportswear,
    minPrice: '899.00', maxPrice: '899.00',
    totalSales: randInt(1000, 3000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/puma-future-rider-trainers/800/800', 'https://picsum.photos/seed/puma-future-rider-trainers-1/800/800'],
    skuList: [
      { code: 'ANTA-KT8-41-WHT', price: '899.00', comparePrice: '1099.00', stock: 100, attributes: { size: '41', color: '白蓝' } },
      { code: 'ANTA-KT8-43-BLK', price: '899.00', comparePrice: '1099.00', stock: 120, attributes: { size: '43', color: '黑金' } },
    ],
  });

  // ── 家居家装 · 家具 ──
  await insertProduct({
    title: '全友家居 布艺沙发 现代简约三人位',
    slug: 'quanyou-fabric-sofa-3seat',
    description: '全友布艺沙发，科技布面料，高回弹海绵，可拆洗设计',
    brand: '全友',
    categoryId: catFurniture,
    minPrice: '3299.00', maxPrice: '4299.00',
    totalSales: randInt(500, 1500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/wooden-bathroom-sink-with-mirror/800/800', 'https://picsum.photos/seed/wooden-bathroom-sink-with-mirror-1/800/800'],
    skuList: [
      { code: 'QY-SOFA-3-GRY', price: '3299.00', comparePrice: '4199.00', stock: 30, lowStock: 5, attributes: { type: '三人位', color: '浅灰' } },
      { code: 'QY-SOFA-L-GRY', price: '4299.00', comparePrice: '5199.00', stock: 20, lowStock: 5, attributes: { type: 'L型转角', color: '浅灰' } },
    ],
  });

  await insertProduct({
    title: '林氏家居 电视柜 现代简约 可伸缩',
    slug: 'linshi-tv-cabinet-retractable',
    description: '林氏家居电视柜，可伸缩设计，适配多种客厅尺寸，板材环保E0级',
    brand: '林氏家居',
    categoryId: catFurniture,
    minPrice: '899.00', maxPrice: '1299.00',
    totalSales: randInt(800, 2500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/bedside-table-african-cherry/800/800', 'https://picsum.photos/seed/decoration-swing/800/800'],
    skuList: [
      { code: 'LS-TV-180-WHT', price: '899.00', comparePrice: '1199.00', stock: 50, attributes: { length: '180cm', color: '暖白' } },
      { code: 'LS-TV-240-WNT', price: '1299.00', comparePrice: '1599.00', stock: 30, attributes: { length: '240cm', color: '胡桃色' } },
    ],
  });

  // ── 家居家装 · 床上用品 ──
  await insertProduct({
    title: '罗莱 桑蚕丝被 春秋被 200×230cm',
    slug: 'luolai-silk-quilt-200x230',
    description: '罗莱100%桑蚕丝被，亲肤透气，恒温舒适，四季可用',
    brand: '罗莱',
    categoryId: catBedding,
    minPrice: '999.00', maxPrice: '1599.00',
    totalSales: randInt(500, 2000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/annibale-colombo-bed-2/800/800', 'https://picsum.photos/seed/annibale-colombo-bed/800/800'],
    skuList: [
      { code: 'LL-SILK-S', price: '999.00', comparePrice: '1399.00', stock: 80, attributes: { weight: '春秋款 1斤', size: '200×230cm' } },
      { code: 'LL-SILK-W', price: '1599.00', comparePrice: '1999.00', stock: 50, attributes: { weight: '冬季款 2斤', size: '200×230cm' } },
    ],
  });

  await insertProduct({
    title: '水星家纺 天然乳胶枕 泰国进口',
    slug: 'mercury-latex-pillow-thailand',
    description: '水星家纺泰国进口天然乳胶枕，波浪曲线，护颈支撑，抗菌防螨',
    brand: '水星家纺',
    categoryId: catBedding,
    minPrice: '199.00', maxPrice: '359.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/latex-pillow/800/800', 'https://picsum.photos/seed/thailand-latex/800/800'],
    skuList: [
      { code: 'SX-LTX-STD', price: '199.00', comparePrice: '299.00', stock: 300, attributes: { type: '标准款', size: '60×40cm' } },
      { code: 'SX-LTX-PAIR', price: '359.00', comparePrice: '499.00', stock: 200, attributes: { type: '一对装', size: '60×40cm' } },
    ],
  });

  // ── 家居家装 · 收纳 ──
  await insertProduct({
    title: '禧天龙 透明鞋盒 加厚 6个装',
    slug: 'citylong-shoe-box-6pack',
    description: '禧天龙透明鞋盒，磁吸开门，加厚PP材质，可叠加，节省空间',
    brand: '禧天龙',
    categoryId: catStorage,
    minPrice: '59.90', maxPrice: '99.90',
    totalSales: randInt(3000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/room-spray/800/800', 'https://picsum.photos/seed/room-spray/800/800'],
    skuList: [
      { code: 'CTL-SHOE-6', price: '59.90', comparePrice: '79.90', stock: 400, attributes: { spec: '6个装', size: '标准款' } },
      { code: 'CTL-SHOE-12', price: '99.90', comparePrice: '139.90', stock: 250, attributes: { spec: '12个装', size: '标准款' } },
    ],
  });

  await insertProduct({
    title: '太力 真空压缩收纳袋 电泵套装',
    slug: 'taili-vacuum-storage-bags-set',
    description: '太力真空压缩袋，食品级PA+PE材质，配电动抽气泵，换季收纳神器',
    brand: '太力',
    categoryId: catStorage,
    minPrice: '49.90', maxPrice: '89.90',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/plant-pot-1/800/800', 'https://picsum.photos/seed/house-showpiece-plant-1/800/800'],
    skuList: [
      { code: 'TL-VAC-8', price: '49.90', comparePrice: '69.90', stock: 300, attributes: { spec: '8袋+手泵' } },
      { code: 'TL-VAC-15P', price: '89.90', comparePrice: '119.90', stock: 200, attributes: { spec: '15袋+电泵' } },
    ],
  });

  // ── 母婴玩具 · 奶粉 ──
  await insertProduct({
    title: '爱他美 卓萃白金版 3段 900g',
    slug: 'aptamil-profutura-stage3-900',
    description: '爱他美卓萃白金版3段，天然乳脂，精萃天然营养小分子，1-3岁',
    brand: '爱他美',
    categoryId: catMilkPowder,
    minPrice: '338.00', maxPrice: '618.00',
    totalSales: randInt(2000, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/protein-powder/800/800', 'https://picsum.photos/seed/milk/800/800'],
    skuList: [
      { code: 'APT-PRO-S3-900', price: '338.00', comparePrice: '398.00', stock: 200, attributes: { spec: '900g', stage: '3段' } },
      { code: 'APT-PRO-S3-900x2', price: '618.00', comparePrice: '796.00', stock: 150, attributes: { spec: '900g×2罐', stage: '3段' } },
    ],
  });

  await insertProduct({
    title: '美赞臣 蓝臻 婴幼儿配方奶粉 2段 900g',
    slug: 'enfamil-enspire-stage2-900',
    description: '美赞臣蓝臻2段，含乳铁蛋白+MFGM乳脂球膜，接近母乳营养',
    brand: '美赞臣',
    categoryId: catMilkPowder,
    minPrice: '378.00', maxPrice: '378.00',
    totalSales: randInt(1500, 3500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/protein-powder/800/800', 'https://picsum.photos/seed/milk/800/800'],
    skuList: [
      { code: 'MJC-LZ-S2-900', price: '378.00', comparePrice: '438.00', stock: 200, attributes: { spec: '900g', stage: '2段' } },
    ],
  });

  // ── 母婴玩具 · 纸尿裤 ──
  await insertProduct({
    title: '好奇 铂金装 纸尿裤 L58片',
    slug: 'huggies-platinum-diaper-l58',
    description: '好奇铂金装纸尿裤，丝柔亲肤，3D悬浮芯体，12小时干爽',
    brand: '好奇',
    categoryId: catDiaper,
    minPrice: '139.00', maxPrice: '249.00',
    totalSales: randInt(2000, 5000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/huggies-l/800/800', 'https://picsum.photos/seed/huggies-xl/800/800'],
    skuList: [
      { code: 'HGS-PLT-L-58', price: '139.00', comparePrice: '169.00', stock: 300, attributes: { size: 'L', spec: '58片' } },
      { code: 'HGS-PLT-L-116', price: '249.00', comparePrice: '319.00', stock: 200, attributes: { size: 'L', spec: '116片(2包)' } },
    ],
  });

  await insertProduct({
    title: '帮宝适 一级帮 拉拉裤 XL42片',
    slug: 'pampers-premium-pants-xl42',
    description: '帮宝适一级帮拉拉裤，日本进口，10倍透气，纱布般柔软',
    brand: '帮宝适',
    categoryId: catDiaper,
    minPrice: '119.00', maxPrice: '219.00',
    totalSales: randInt(1500, 4000),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/pampers-xl/800/800', 'https://picsum.photos/seed/premium/800/800'],
    skuList: [
      { code: 'PMP-1-XL-42', price: '119.00', comparePrice: '149.00', stock: 350, attributes: { size: 'XL', spec: '42片' } },
      { code: 'PMP-1-XL-84', price: '219.00', comparePrice: '279.00', stock: 200, attributes: { size: 'XL', spec: '84片(2包)' } },
    ],
  });

  // ── 母婴玩具 · 玩具 ──
  await insertProduct({
    title: 'Fisher-Price 费雪 学步车 多功能',
    slug: 'fisher-price-learn-walker',
    description: 'Fisher-Price 学步车，坐玩站走四合一，早教音乐游戏面板',
    brand: 'Fisher-Price',
    categoryId: catToys,
    minPrice: '269.00', maxPrice: '269.00',
    totalSales: randInt(1500, 3500),
    avgRating: randRating(), reviewCount: randReviews(),
    imageUrls: ['https://picsum.photos/seed/fisher-walker/800/800', 'https://picsum.photos/seed/learn-walk/800/800'],
    skuList: [
      { code: 'FP-WALKER-BLU', price: '269.00', comparePrice: '349.00', stock: 150, attributes: { color: '蓝色', ageRange: '6-36个月' } },
      { code: 'FP-WALKER-PNK', price: '269.00', comparePrice: '349.00', stock: 120, attributes: { color: '粉色', ageRange: '6-36个月' } },
    ],
  });

  // ── Bulk catalog: 批量插入 ~500 个商品覆盖所有30个二级分类 ──
  const catSlugMap: Record<string, string> = {
    phones: catPhone, earphones: catEarphone, 'smart-watches': catSmartWatch,
    laptops: catLaptop, tablets: catTablet, keyboards: catKeyboard,
    'big-appliance': catBigAppliance, 'small-appliance': catSmallAppliance, 'kitchen-appliance': catKitchen,
    menswear: catMenswear, womenswear: catWomenswear, shoes: catShoes,
    snacks: catSnacks, drinks: catDrinks, fresh: catFresh,
    skincare: catSkincare, makeup: catMakeup, 'wash-care': catWashCare,
    literature: catLiterature, education: catEducation, comic: catComic,
    fitness: catFitness, outdoor: catOutdoor, sportswear: catSportswear,
    furniture: catFurniture, bedding: catBedding, storage: catStorage,
    'milk-powder': catMilkPowder, diapers: catDiaper, toys: catToys,
  };

  console.log('Bulk inserting catalog products...');
  let bulkCount = 0;
  for (const cat of bulkCatalog) {
    const categoryId = catSlugMap[cat.catSlug];
    if (!categoryId) { console.warn(`  ⚠ Unknown catSlug: ${cat.catSlug}, skipping`); continue; }
    for (const p of cat.products) {
      const maxP = p.mp ?? p.p;
      const baseCode = p.s.replace(/-/g, '_').toUpperCase().substring(0, 22);
      const skuList = p.p === maxP
        ? [{ code: `${baseCode}_S`, price: p.p.toFixed(2), comparePrice: Math.round(p.p * 1.15).toFixed(2), stock: randInt(50, 400), attributes: { spec: '标准' } }]
        : [
            { code: `${baseCode}_V1`, price: p.p.toFixed(2), comparePrice: Math.round(p.p * 1.12).toFixed(2), stock: randInt(80, 350), attributes: { spec: '标准版' } },
            { code: `${baseCode}_V2`, price: maxP.toFixed(2), comparePrice: Math.round(maxP * 1.1).toFixed(2), stock: randInt(40, 200), attributes: { spec: '升级版' } },
          ];
      // 从图片池按索引取图，每个商品不重复
      const pool = categoryImagePool[cat.catSlug] ?? [];
      const imgIdx = bulkCount % Math.max(pool.length, 1);
      const imageUrls = pool.length > 0
        ? [pool[imgIdx], pool[(imgIdx + 1) % pool.length]]
        : [placeholderImg(p.b.substring(0, 10), cat.bg, 'FFF'), placeholderImg(p.t.substring(0, 12), cat.bg, 'FFF')];

      await insertProduct({
        title: p.t, slug: p.s, description: p.d, brand: p.b,
        categoryId,
        minPrice: p.p.toFixed(2), maxPrice: maxP.toFixed(2),
        totalSales: randInt(100, 5000),
        avgRating: randRating(), reviewCount: randReviews(),
        imageUrls,
        skuList,
      });
      bulkCount++;
    }
  }
  console.log(`  ${bulkCount} bulk catalog products inserted.\n`);

  const totalProducts = 92 + bulkCount;
  console.log(`  ${totalProducts} products, ${allSkuData.length} SKUs created\n`);

  // ══════════════════════════════════════════════════════════════
  // ── 6. 首页 Banner 轮播图 ──
  // ══════════════════════════════════════════════════════════════
  console.log('Inserting banners...');
  await db.insert(banners).values([
    {
      id: seedId('banner:1'),
      title: '春季数码焕新',
      subtitle: '手机电脑限时特惠，最高立减2000元',
      imageUrl: 'https://picsum.photos/seed/iphone-13-pro/800/800',
      linkType: 'category',
      linkValue: 'digital',
      sortOrder: 1,
      isActive: true,
    },
    {
      id: seedId('banner:2'),
      title: 'iPhone 15 Pro Max',
      subtitle: 'A17 Pro 芯片，钛金属边框，从9999起',
      imageUrl: 'https://picsum.photos/seed/iphone-13-pro-1/800/800',
      linkType: 'product',
      linkValue: 'iphone-15-pro-max',
      sortOrder: 2,
      isActive: true,
    },
    {
      id: seedId('banner:3'),
      title: '时尚女装专场',
      subtitle: '春夏新品上市，满299减50',
      imageUrl: 'https://picsum.photos/seed/dress-pea/800/800',
      linkType: 'category',
      linkValue: 'womenswear',
      sortOrder: 3,
      isActive: true,
    },
    {
      id: seedId('banner:4'),
      title: '戴森超级品牌日',
      subtitle: '吸尘器/吹风机全线优惠',
      imageUrl: 'https://picsum.photos/seed/dyson-v15-detect/800/800',
      linkType: 'product',
      linkValue: 'dyson-v15-detect',
      sortOrder: 4,
      isActive: true,
    },
    {
      id: seedId('banner:5'),
      title: '图书满100减50',
      subtitle: '经典文学、教育、漫画全场参与',
      imageUrl: 'https://picsum.photos/seed/best-sellers/800/800',
      linkType: 'category',
      linkValue: 'books',
      sortOrder: 5,
      isActive: true,
    },
    {
      id: seedId('banner:6'),
      title: '生鲜好物精选',
      subtitle: '新鲜水果产地直发，次日达',
      imageUrl: 'https://picsum.photos/seed/strawberry/800/800',
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
