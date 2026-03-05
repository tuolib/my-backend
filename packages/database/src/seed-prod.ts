/**
 * 生产环境基础数据初始化
 * 只插入分类、商品、图片、SKU 等商品目录数据
 * 不清空表，使用 ON CONFLICT DO NOTHING 保证幂等
 * 不插入测试用户、测试地址
 * 用法: NODE_ENV=production bun run seed:prod
 */
import { sql } from 'drizzle-orm';
import { db, connection } from './client';
import { redis } from './redis';
import { generateId } from '@repo/shared';
import { getStock, setStock } from './lua';
import {
  categories,
  products,
  productCategories,
  productImages,
  skus,
  banners,
} from './schema';
import { bulkCatalog } from './seed-prod-catalog';

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

// ── 辅助：随机评分 (3.5 ~ 5.0) ──
function randRating(): string {
  return (3.5 + Math.random() * 1.5).toFixed(1);
}

// ── 辅助：随机评论数 ──
function randReviews(): number {
  return randInt(50, 5000);
}

// ── 收集所有 SKU 用于 Redis 初始化 ──
const allSkuData: Array<{ id: string; stock: number }> = [];

/**
 * 幂等插入单条分类
 * 使用 slug 作为冲突判断依据（slug 有 unique 约束）
 */
async function upsertCategory(values: {
  id: string;
  parentId?: string;
  name: string;
  slug: string;
  iconUrl?: string;
  sortOrder: number;
}) {
  await db.execute(sql`
    INSERT INTO product_service.categories (id, parent_id, name, slug, icon_url, sort_order, is_active, created_at, updated_at)
    VALUES (${values.id}, ${values.parentId ?? null}, ${values.name}, ${values.slug}, ${values.iconUrl ?? null}, ${values.sortOrder}, true, NOW(), NOW())
    ON CONFLICT (slug) DO NOTHING
  `);
}

/**
 * 幂等插入完整商品（product + images + category关联 + SKUs）
 * 使用 slug 作为商品冲突判断，sku_code 作为 SKU 冲突判断
 */
async function insertProductIfNotExists(opts: {
  title: string;
  slug: string;
  description: string;
  brand: string;
  categoryId: string;
  minPrice: string;
  maxPrice: string;
  totalSales: number;
  avgRating?: string;
  reviewCount?: number;
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
  // 检查商品是否已存在
  const existing = await db.execute(
    sql`SELECT id, data_source FROM product_service.products WHERE slug = ${opts.slug} LIMIT 1`
  );

  if (existing.length > 0) {
    const row = (existing as any[])[0];

    // Admin 修改过的记录不碰
    if (row.data_source !== 'seed') {
      console.log(`  [skip] "${opts.title}" (managed by ${row.data_source})`);
      return;
    }

    // data_source='seed' → 更新商品信息 + 图片
    const prodId = row.id;
    await db.execute(sql`
      UPDATE product_service.products
      SET title = ${opts.title}, description = ${opts.description}, brand = ${opts.brand},
          min_price = ${opts.minPrice}, max_price = ${opts.maxPrice},
          updated_at = NOW()
      WHERE id = ${prodId} AND data_source = 'seed'
    `);

    // 替换图片
    await db.execute(sql`DELETE FROM product_service.product_images WHERE product_id = ${prodId}`);
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

    // SKU 幂等插入（不更新已有 SKU）
    for (const s of opts.skuList) {
      const skuId = generateId();
      allSkuData.push({ id: skuId, stock: s.stock });
      await db.execute(sql`
        INSERT INTO product_service.skus (id, product_id, sku_code, price, compare_price, stock, low_stock, attributes, status, version, created_at, updated_at)
        VALUES (${skuId}, ${prodId}, ${s.code}, ${s.price}, ${s.comparePrice ?? null}, ${s.stock}, ${s.lowStock ?? 5}, ${JSON.stringify(s.attributes)}::jsonb, 'active', 0, NOW(), NOW())
        ON CONFLICT (sku_code) DO NOTHING
      `);
    }

    console.log(`  [update] "${opts.title}" (seed-managed, refreshed)`);
    return;
  }

  // 新商品 → 全新插入
  const prodId = generateId();

  await db.insert(products).values({
    id: prodId,
    title: opts.title,
    slug: opts.slug,
    description: opts.description,
    brand: opts.brand,
    status: 'active',
    dataSource: 'seed',
    minPrice: opts.minPrice,
    maxPrice: opts.maxPrice,
    totalSales: opts.totalSales,
    avgRating: opts.avgRating ?? randRating(),
    reviewCount: opts.reviewCount ?? randReviews(),
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

  for (const s of opts.skuList) {
    const skuId = generateId();
    allSkuData.push({ id: skuId, stock: s.stock });
    await db.execute(sql`
      INSERT INTO product_service.skus (id, product_id, sku_code, price, compare_price, stock, low_stock, attributes, status, version, created_at, updated_at)
      VALUES (${skuId}, ${prodId}, ${s.code}, ${s.price}, ${s.comparePrice ?? null}, ${s.stock}, ${s.lowStock ?? 5}, ${JSON.stringify(s.attributes)}::jsonb, 'active', 0, NOW(), NOW())
      ON CONFLICT (sku_code) DO NOTHING
    `);
  }

  console.log(`  [new] "${opts.title}" inserted`);
}

async function seedProd() {
  console.log('Production seed: inserting catalog data...\n');

  // ══════════════════════════════════════════════════════════════
  // 分类
  // ══════════════════════════════════════════════════════════════
  console.log('Upserting categories...');

  // 一级分类 ID（使用固定 ID 以便二级分类引用，但冲突时不覆盖）
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

  // 一级分类
  const topCategories = [
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
  ];

  for (const cat of topCategories) {
    await upsertCategory(cat);
  }

  // 为了让二级分类关联正确的 parentId，需要查询已存在的一级分类
  // 因为 ON CONFLICT DO NOTHING 可能导致 ID 不匹配
  const parentMap = new Map<string, string>();
  const existingTopCats = await db.execute(
    sql`SELECT id, slug FROM product_service.categories WHERE parent_id IS NULL`
  );
  for (const row of existingTopCats as any[]) {
    parentMap.set(row.slug, row.id);
  }

  const getParentId = (slug: string) => parentMap.get(slug)!;

  // 二级分类
  const subCategories = [
    { id: catPhone, parentId: getParentId('digital'), name: '手机', slug: 'phones', sortOrder: 1 },
    { id: catEarphone, parentId: getParentId('digital'), name: '耳机', slug: 'earphones', sortOrder: 2 },
    { id: catSmartWatch, parentId: getParentId('digital'), name: '智能手表', slug: 'smart-watches', sortOrder: 3 },
    { id: catLaptop, parentId: getParentId('computer'), name: '笔记本电脑', slug: 'laptops', sortOrder: 1 },
    { id: catTablet, parentId: getParentId('computer'), name: '平板电脑', slug: 'tablets', sortOrder: 2 },
    { id: catKeyboard, parentId: getParentId('computer'), name: '键盘鼠标', slug: 'keyboards', sortOrder: 3 },
    { id: catBigAppliance, parentId: getParentId('appliance'), name: '冰箱洗衣机', slug: 'big-appliance', sortOrder: 1 },
    { id: catSmallAppliance, parentId: getParentId('appliance'), name: '小家电', slug: 'small-appliance', sortOrder: 2 },
    { id: catKitchen, parentId: getParentId('appliance'), name: '厨房电器', slug: 'kitchen-appliance', sortOrder: 3 },
    { id: catMenswear, parentId: getParentId('clothing'), name: '男装', slug: 'menswear', sortOrder: 1 },
    { id: catWomenswear, parentId: getParentId('clothing'), name: '女装', slug: 'womenswear', sortOrder: 2 },
    { id: catShoes, parentId: getParentId('clothing'), name: '鞋靴', slug: 'shoes', sortOrder: 3 },
    { id: catSnacks, parentId: getParentId('food'), name: '零食', slug: 'snacks', sortOrder: 1 },
    { id: catDrinks, parentId: getParentId('food'), name: '饮料', slug: 'drinks', sortOrder: 2 },
    { id: catFresh, parentId: getParentId('food'), name: '生鲜', slug: 'fresh', sortOrder: 3 },
    { id: catSkincare, parentId: getParentId('beauty'), name: '护肤', slug: 'skincare', sortOrder: 1 },
    { id: catMakeup, parentId: getParentId('beauty'), name: '彩妆', slug: 'makeup', sortOrder: 2 },
    { id: catWashCare, parentId: getParentId('beauty'), name: '洗护', slug: 'wash-care', sortOrder: 3 },
    { id: catLiterature, parentId: getParentId('books'), name: '文学', slug: 'literature', sortOrder: 1 },
    { id: catEducation, parentId: getParentId('books'), name: '教育', slug: 'education', sortOrder: 2 },
    { id: catComic, parentId: getParentId('books'), name: '漫画', slug: 'comic', sortOrder: 3 },
    { id: catFitness, parentId: getParentId('sports'), name: '健身器材', slug: 'fitness', sortOrder: 1 },
    { id: catOutdoor, parentId: getParentId('sports'), name: '户外装备', slug: 'outdoor', sortOrder: 2 },
    { id: catSportswear, parentId: getParentId('sports'), name: '运动服饰', slug: 'sportswear', sortOrder: 3 },
    { id: catFurniture, parentId: getParentId('home'), name: '家具', slug: 'furniture', sortOrder: 1 },
    { id: catBedding, parentId: getParentId('home'), name: '床上用品', slug: 'bedding', sortOrder: 2 },
    { id: catStorage, parentId: getParentId('home'), name: '收纳', slug: 'storage', sortOrder: 3 },
    { id: catMilkPowder, parentId: getParentId('baby'), name: '奶粉', slug: 'milk-powder', sortOrder: 1 },
    { id: catDiaper, parentId: getParentId('baby'), name: '纸尿裤', slug: 'diapers', sortOrder: 2 },
    { id: catToys, parentId: getParentId('baby'), name: '玩具', slug: 'toys', sortOrder: 3 },
  ];

  for (const cat of subCategories) {
    await upsertCategory(cat);
  }
  console.log('  Categories upserted.\n');

  // 重新查询二级分类的真实 ID（可能已存在）
  const subMap = new Map<string, string>();
  const existingSubCats = await db.execute(
    sql`SELECT id, slug FROM product_service.categories WHERE parent_id IS NOT NULL`
  );
  for (const row of existingSubCats as any[]) {
    subMap.set(row.slug, row.id);
  }
  const getCatId = (slug: string) => subMap.get(slug)!;

  // ══════════════════════════════════════════════════════════════
  // 商品（与 seed.ts 相同的数据，但使用幂等插入）
  // ══════════════════════════════════════════════════════════════
  console.log('Inserting products (skip existing)...');

  // 手机数码
  await insertProductIfNotExists({
    title: 'iPhone 15 Pro Max 256GB', slug: 'iphone-15-pro-max',
    description: 'Apple iPhone 15 Pro Max，A17 Pro 芯片，钛金属边框，超长续航',
    brand: 'Apple', categoryId: getCatId('phones'),
    minPrice: '9999.00', maxPrice: '13999.00', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('smartphones/iphone-13-pro/1.webp'), cdnImg('smartphones/iphone-13-pro/2.webp'), cdnImg('smartphones/iphone-13-pro/3.webp')],
    skuList: [
      { code: 'IP15PM-256-NAT', price: '9999.00', comparePrice: '10999.00', stock: 200, attributes: { storage: '256GB', color: '原色钛金属' } },
      { code: 'IP15PM-512-NAT', price: '11999.00', comparePrice: '12999.00', stock: 150, attributes: { storage: '512GB', color: '原色钛金属' } },
      { code: 'IP15PM-1T-BLK', price: '13999.00', comparePrice: '14999.00', stock: 80, lowStock: 10, attributes: { storage: '1TB', color: '黑色钛金属' } },
    ],
  });

  await insertProductIfNotExists({
    title: '华为 Mate 60 Pro', slug: 'huawei-mate60-pro',
    description: '华为 Mate 60 Pro，麒麟芯片回归，卫星通话，昆仑玻璃',
    brand: '华为', categoryId: getCatId('phones'),
    minPrice: '6999.00', maxPrice: '7999.00', totalSales: randInt(3000, 5000),
    imageUrls: [cdnImg('smartphones/samsung-galaxy-s8/1.webp'), cdnImg('smartphones/samsung-galaxy-s8/2.webp')],
    skuList: [
      { code: 'MATE60P-256-BLK', price: '6999.00', comparePrice: '7499.00', stock: 300, attributes: { storage: '256GB', color: '雅丹黑' } },
      { code: 'MATE60P-512-WHT', price: '7999.00', comparePrice: '8499.00', stock: 200, attributes: { storage: '512GB', color: '白沙银' } },
    ],
  });

  await insertProductIfNotExists({
    title: '小米14 Ultra', slug: 'xiaomi-14-ultra',
    description: '小米14 Ultra，徕卡光学镜头，骁龙8 Gen3，专业影像旗舰',
    brand: '小米', categoryId: getCatId('phones'),
    minPrice: '5999.00', maxPrice: '6499.00', totalSales: randInt(1500, 4000),
    imageUrls: [cdnImg('smartphones/oppo-f19-pro-plus/1.webp'), cdnImg('smartphones/realme-xt/1.webp')],
    skuList: [
      { code: 'MI14U-256-BLK', price: '5999.00', comparePrice: '6299.00', stock: 250, attributes: { storage: '256GB', color: '黑色' } },
      { code: 'MI14U-512-WHT', price: '6499.00', comparePrice: '6999.00', stock: 180, attributes: { storage: '512GB', color: '白色' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'Samsung Galaxy S24 Ultra', slug: 'samsung-galaxy-s24-ultra',
    description: '三星 Galaxy S24 Ultra，钛金属边框，Galaxy AI，2亿像素，S Pen',
    brand: 'Samsung', categoryId: getCatId('phones'),
    minPrice: '9699.00', maxPrice: '13699.00', totalSales: randInt(1500, 4000),
    imageUrls: [cdnImg('smartphones/samsung-galaxy-s10/1.webp'), cdnImg('smartphones/samsung-galaxy-s10/2.webp'), cdnImg('smartphones/samsung-galaxy-s10/3.webp')],
    skuList: [
      { code: 'S24U-256-BLK', price: '9699.00', comparePrice: '10499.00', stock: 180, attributes: { storage: '256GB', color: '钛黑' } },
      { code: 'S24U-512-VIO', price: '11699.00', comparePrice: '12499.00', stock: 120, attributes: { storage: '512GB', color: '钛紫' } },
      { code: 'S24U-1T-GRY', price: '13699.00', comparePrice: '14499.00', stock: 60, lowStock: 10, attributes: { storage: '1TB', color: '钛灰' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'AirPods Pro 第二代', slug: 'airpods-pro-2',
    description: 'Apple AirPods Pro 2，自适应降噪，个性化空间音频，USB-C 充电',
    brand: 'Apple', categoryId: getCatId('earphones'),
    minPrice: '1799.00', maxPrice: '1799.00', totalSales: randInt(3000, 5000),
    imageUrls: [cdnImg('mobile-accessories/apple-airpods/1.webp'), cdnImg('mobile-accessories/apple-airpods/2.webp')],
    skuList: [
      { code: 'APP2-USBC', price: '1799.00', comparePrice: '1999.00', stock: 500, attributes: { version: 'USB-C', color: '白色' } },
    ],
  });

  await insertProductIfNotExists({
    title: '索尼 WH-1000XM5 头戴式降噪耳机', slug: 'sony-wh1000xm5',
    description: '索尼旗舰降噪耳机，30小时续航，高解析度音频，佩戴舒适',
    brand: 'Sony', categoryId: getCatId('earphones'),
    minPrice: '2299.00', maxPrice: '2299.00', totalSales: randInt(1000, 3000),
    imageUrls: [cdnImg('mobile-accessories/apple-airpods-max-silver/1.webp'), cdnImg('mobile-accessories/beats-flex-wireless-earphones/1.webp')],
    skuList: [
      { code: 'XM5-BLK', price: '2299.00', comparePrice: '2699.00', stock: 200, attributes: { color: '黑色' } },
      { code: 'XM5-SLV', price: '2299.00', comparePrice: '2699.00', stock: 150, attributes: { color: '铂金银' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'Apple Watch Ultra 2', slug: 'apple-watch-ultra-2',
    description: 'Apple Watch Ultra 2，钛金属表壳，精准双频GPS，水下深度计',
    brand: 'Apple', categoryId: getCatId('smart-watches'),
    minPrice: '6499.00', maxPrice: '6499.00', totalSales: randInt(500, 2000),
    imageUrls: [cdnImg('mobile-accessories/apple-watch-series-4-gold/1.webp'), cdnImg('mobile-accessories/apple-watch-series-4-gold/2.webp')],
    skuList: [
      { code: 'AWU2-49-ORG', price: '6499.00', comparePrice: '6999.00', stock: 100, lowStock: 10, attributes: { size: '49mm', band: '橙色Alpine回环' } },
    ],
  });

  // 电脑办公
  await insertProductIfNotExists({
    title: 'MacBook Pro 14 英寸 M3 Pro', slug: 'macbook-pro-14-m3pro',
    description: 'Apple MacBook Pro 14 英寸，M3 Pro 芯片，Liquid Retina XDR 显示屏',
    brand: 'Apple', categoryId: getCatId('laptops'),
    minPrice: '14999.00', maxPrice: '19999.00', totalSales: randInt(1000, 3000),
    imageUrls: [cdnImg('laptops/apple-macbook-pro-14-inch-space-grey/1.webp'), cdnImg('laptops/apple-macbook-pro-14-inch-space-grey/2.webp'), cdnImg('laptops/apple-macbook-pro-14-inch-space-grey/3.webp')],
    skuList: [
      { code: 'MBP14-M3P-18-512', price: '14999.00', comparePrice: '16499.00', stock: 120, attributes: { chip: 'M3 Pro', memory: '18GB', storage: '512GB' } },
      { code: 'MBP14-M3P-36-1T', price: '19999.00', comparePrice: '21999.00', stock: 60, lowStock: 10, attributes: { chip: 'M3 Pro', memory: '36GB', storage: '1TB' } },
    ],
  });

  await insertProductIfNotExists({
    title: '联想 ThinkPad X1 Carbon Gen 11', slug: 'thinkpad-x1-carbon-11',
    description: '联想 ThinkPad X1 Carbon，14英寸2.8K OLED屏，轻薄商务本',
    brand: 'Lenovo', categoryId: getCatId('laptops'),
    minPrice: '9999.00', maxPrice: '12999.00', totalSales: randInt(800, 2500),
    imageUrls: [cdnImg('laptops/lenovo-yoga-920/1.webp'), cdnImg('laptops/lenovo-yoga-920/2.webp')],
    skuList: [
      { code: 'X1C11-i5-16-512', price: '9999.00', comparePrice: '11499.00', stock: 100, attributes: { cpu: 'i5-1340P', memory: '16GB', storage: '512GB' } },
      { code: 'X1C11-i7-32-1T', price: '12999.00', comparePrice: '14999.00', stock: 80, attributes: { cpu: 'i7-1365H', memory: '32GB', storage: '1TB' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'iPad Air M2', slug: 'ipad-air-m2',
    description: 'Apple iPad Air M2 芯片，11英寸 Liquid Retina 显示屏，支持 Apple Pencil Pro',
    brand: 'Apple', categoryId: getCatId('tablets'),
    minPrice: '4799.00', maxPrice: '6499.00', totalSales: randInt(1500, 4000),
    imageUrls: [cdnImg('tablets/ipad-mini-2021-starlight/1.webp'), cdnImg('tablets/ipad-mini-2021-starlight/2.webp')],
    skuList: [
      { code: 'IPAM2-128-BLU', price: '4799.00', comparePrice: '5299.00', stock: 200, attributes: { storage: '128GB', color: '蓝色' } },
      { code: 'IPAM2-256-PUR', price: '5499.00', comparePrice: '5999.00', stock: 150, attributes: { storage: '256GB', color: '紫色' } },
      { code: 'IPAM2-512-GRY', price: '6499.00', comparePrice: '6999.00', stock: 100, attributes: { storage: '512GB', color: '深空灰' } },
    ],
  });

  await insertProductIfNotExists({
    title: '华为 MatePad Pro 13.2 英寸', slug: 'huawei-matepad-pro-13',
    description: '华为 MatePad Pro 13.2，OLED柔性屏，星闪连接，天生会画',
    brand: '华为', categoryId: getCatId('tablets'),
    minPrice: '5199.00', maxPrice: '5999.00', totalSales: randInt(500, 2000),
    imageUrls: [cdnImg('tablets/samsung-galaxy-tab-s8-plus-grey/1.webp'), cdnImg('tablets/samsung-galaxy-tab-s8-plus-grey/2.webp')],
    skuList: [
      { code: 'MPP13-256-BLK', price: '5199.00', comparePrice: '5699.00', stock: 120, attributes: { storage: '256GB', color: '曜金黑' } },
      { code: 'MPP13-512-WHT', price: '5999.00', comparePrice: '6499.00', stock: 80, attributes: { storage: '512GB', color: '晶钻白' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'HHKB Professional HYBRID Type-S', slug: 'hhkb-hybrid-types',
    description: 'HHKB 静电容键盘，蓝牙/USB双模，静音版，程序员神器',
    brand: 'HHKB', categoryId: getCatId('keyboards'),
    minPrice: '2499.00', maxPrice: '2499.00', totalSales: randInt(300, 1500),
    imageUrls: [placeholderImg('HHKB+Keyboard', '333', 'FFF'), placeholderImg('HHKB+Type-S', '333', 'FFF')],
    skuList: [
      { code: 'HHKB-HTS-WHT', price: '2499.00', comparePrice: '2799.00', stock: 80, lowStock: 10, attributes: { color: '白色', layout: '60键' } },
      { code: 'HHKB-HTS-BLK', price: '2499.00', comparePrice: '2799.00', stock: 60, lowStock: 10, attributes: { color: '墨色', layout: '60键' } },
    ],
  });

  // 家用电器
  await insertProductIfNotExists({
    title: '戴森 V15 Detect 无绳吸尘器', slug: 'dyson-v15-detect',
    description: '戴森 V15 Detect，激光探测灰尘，整机密封HEPA过滤，60分钟续航',
    brand: 'Dyson', categoryId: getCatId('small-appliance'),
    minPrice: '4590.00', maxPrice: '4590.00', totalSales: randInt(1000, 3000),
    imageUrls: [placeholderImg('Dyson+V15', 'F59E0B', 'FFF'), placeholderImg('Dyson+Detect', 'D97706', 'FFF'), placeholderImg('Dyson+HEPA', 'B45309', 'FFF')],
    skuList: [
      { code: 'V15-DETECT-GLD', price: '4590.00', comparePrice: '5490.00', stock: 100, attributes: { color: '金色', version: '旗舰版' } },
    ],
  });

  await insertProductIfNotExists({
    title: '戴森 Supersonic 吹风机 HD15', slug: 'dyson-supersonic-hd15',
    description: '戴森吹风机 HD15，智能温控，防飞翘风嘴，5款造型风嘴',
    brand: 'Dyson', categoryId: getCatId('small-appliance'),
    minPrice: '3199.00', maxPrice: '3199.00', totalSales: randInt(2000, 5000),
    imageUrls: [placeholderImg('Dyson+HD15', 'EC4899', 'FFF'), placeholderImg('Dyson+Supersonic', 'DB2777', 'FFF')],
    skuList: [
      { code: 'DYSON-HD15-FUC', price: '3199.00', comparePrice: '3599.00', stock: 150, attributes: { color: '紫红镍色' } },
      { code: 'DYSON-HD15-BLU', price: '3199.00', comparePrice: '3599.00', stock: 120, attributes: { color: '璀璨蓝金' } },
    ],
  });

  await insertProductIfNotExists({
    title: '海尔冰箱 BCD-510WDPZ', slug: 'haier-fridge-510',
    description: '海尔510升对开门冰箱，风冷无霜，变频节能，干湿分储',
    brand: '海尔', categoryId: getCatId('big-appliance'),
    minPrice: '3299.00', maxPrice: '3299.00', totalSales: randInt(800, 2000),
    imageUrls: [placeholderImg('Haier+Fridge', '60A5FA', 'FFF'), placeholderImg('Haier+510L', '3B82F6', 'FFF')],
    skuList: [
      { code: 'HAIER-510-GLD', price: '3299.00', comparePrice: '3999.00', stock: 50, lowStock: 10, attributes: { color: '金色', capacity: '510L' } },
    ],
  });

  await insertProductIfNotExists({
    title: '美的电饭煲 MB-FB40Simple', slug: 'midea-rice-cooker-fb40',
    description: '美的智能电饭煲，4L大容量，24小时预约，多功能菜单',
    brand: '美的', categoryId: getCatId('kitchen-appliance'),
    minPrice: '299.00', maxPrice: '299.00', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('kitchen-accessories/electric-stove/1.webp'), cdnImg('kitchen-accessories/silver-pot-with-glass-cap/1.webp')],
    skuList: [
      { code: 'MIDEA-FB40-WHT', price: '299.00', comparePrice: '399.00', stock: 300, attributes: { color: '白色', capacity: '4L' } },
    ],
  });

  // 服饰鞋包
  await insertProductIfNotExists({
    title: 'Nike Dri-FIT 速干运动T恤 男款', slug: 'nike-drifit-tshirt-men',
    description: 'Nike Dri-FIT 科技面料，吸湿排汗，运动休闲百搭款',
    brand: 'Nike', categoryId: getCatId('menswear'),
    minPrice: '229.00', maxPrice: '229.00', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('mens-shirts/man-short-sleeve-shirt/1.webp'), cdnImg('mens-shirts/man-short-sleeve-shirt/2.webp')],
    skuList: [
      { code: 'NIKE-DF-M-S-BLK', price: '229.00', comparePrice: '299.00', stock: 300, attributes: { size: 'S', color: '黑色' } },
      { code: 'NIKE-DF-M-M-BLK', price: '229.00', comparePrice: '299.00', stock: 400, attributes: { size: 'M', color: '黑色' } },
      { code: 'NIKE-DF-M-L-BLK', price: '229.00', comparePrice: '299.00', stock: 350, attributes: { size: 'L', color: '黑色' } },
      { code: 'NIKE-DF-M-XL-BLK', price: '229.00', comparePrice: '299.00', stock: 200, attributes: { size: 'XL', color: '黑色' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'Levi\'s 501 经典直筒牛仔裤 男款', slug: 'levis-501-original-men',
    description: 'Levi\'s 501 Original，经典直筒剪裁，纯棉牛仔布，百年经典',
    brand: 'Levi\'s', categoryId: getCatId('menswear'),
    minPrice: '599.00', maxPrice: '599.00', totalSales: randInt(1500, 4000),
    imageUrls: [cdnImg('mens-shirts/blue-&-black-check-shirt/1.webp'), cdnImg('mens-shirts/blue-&-black-check-shirt/2.webp')],
    skuList: [
      { code: 'LEVI501-30-BLU', price: '599.00', comparePrice: '799.00', stock: 150, attributes: { size: '30', color: '中蓝' } },
      { code: 'LEVI501-32-BLU', price: '599.00', comparePrice: '799.00', stock: 200, attributes: { size: '32', color: '中蓝' } },
      { code: 'LEVI501-34-DRK', price: '599.00', comparePrice: '799.00', stock: 130, attributes: { size: '34', color: '深蓝' } },
    ],
  });

  await insertProductIfNotExists({
    title: '优衣库 女式轻薄羽绒服', slug: 'uniqlo-ultra-light-down-women',
    description: '优衣库 Ultra Light Down，超轻便携，90%优质白鸭绒，可收纳',
    brand: 'UNIQLO', categoryId: getCatId('womenswear'),
    minPrice: '499.00', maxPrice: '499.00', totalSales: randInt(3000, 5000),
    imageUrls: [cdnImg('tops/gray-dress/1.webp'), cdnImg('tops/gray-dress/2.webp')],
    skuList: [
      { code: 'UQ-ULD-W-S-PNK', price: '499.00', comparePrice: '599.00', stock: 200, attributes: { size: 'S', color: '樱花粉' } },
      { code: 'UQ-ULD-W-M-BLK', price: '499.00', comparePrice: '599.00', stock: 250, attributes: { size: 'M', color: '黑色' } },
      { code: 'UQ-ULD-W-L-NVY', price: '499.00', comparePrice: '599.00', stock: 180, attributes: { size: 'L', color: '藏青' } },
    ],
  });

  await insertProductIfNotExists({
    title: '碎花连衣裙 法式复古气质款', slug: 'floral-dress-french-vintage',
    description: '法式复古碎花连衣裙，V领收腰设计，雪纺面料，优雅气质',
    brand: 'ElegantLady', categoryId: getCatId('womenswear'),
    minPrice: '299.00', maxPrice: '299.00', totalSales: randInt(1500, 4000),
    imageUrls: [cdnImg('womens-dresses/dress-pea/1.webp'), cdnImg('womens-dresses/dress-pea/2.webp'), cdnImg('womens-dresses/dress-pea/3.webp')],
    skuList: [
      { code: 'FD-FV-S-FLR', price: '299.00', comparePrice: '459.00', stock: 180, attributes: { size: 'S', color: '碎花白' } },
      { code: 'FD-FV-M-FLR', price: '299.00', comparePrice: '459.00', stock: 220, attributes: { size: 'M', color: '碎花白' } },
      { code: 'FD-FV-L-FLR', price: '299.00', comparePrice: '459.00', stock: 150, attributes: { size: 'L', color: '碎花白' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'Adidas Ultraboost Light 跑步鞋', slug: 'adidas-ultraboost-light',
    description: 'Adidas Ultraboost Light，轻量化BOOST中底，编织鞋面，缓震舒适',
    brand: 'Adidas', categoryId: getCatId('shoes'),
    minPrice: '1099.00', maxPrice: '1099.00', totalSales: randInt(1000, 3000),
    imageUrls: [cdnImg('mens-shoes/sports-sneakers-off-white-&-red/1.webp'), cdnImg('mens-shoes/sports-sneakers-off-white-&-red/2.webp'), cdnImg('mens-shoes/sports-sneakers-off-white-&-red/3.webp')],
    skuList: [
      { code: 'UBL-40-BLK', price: '1099.00', comparePrice: '1299.00', stock: 100, attributes: { size: '40', color: '黑白' } },
      { code: 'UBL-42-BLK', price: '1099.00', comparePrice: '1299.00', stock: 120, attributes: { size: '42', color: '黑白' } },
      { code: 'UBL-43-BLK', price: '1099.00', comparePrice: '1299.00', stock: 80, lowStock: 10, attributes: { size: '43', color: '黑白' } },
    ],
  });

  // 食品生鲜
  await insertProductIfNotExists({
    title: '三只松鼠 每日坚果混合装 30包', slug: 'three-squirrels-daily-nuts',
    description: '三只松鼠每日坚果，6种坚果+3种果干，独立小包装，锁鲜工艺',
    brand: '三只松鼠', categoryId: getCatId('snacks'),
    minPrice: '69.90', maxPrice: '129.00', totalSales: randInt(3000, 5000),
    imageUrls: [cdnImg('groceries/mulberry/1.webp'), cdnImg('groceries/honey-jar/1.webp')],
    skuList: [
      { code: 'SZS-NUTS-15', price: '69.90', comparePrice: '89.90', stock: 500, attributes: { spec: '15包装' } },
      { code: 'SZS-NUTS-30', price: '129.00', comparePrice: '159.00', stock: 400, attributes: { spec: '30包装' } },
    ],
  });

  await insertProductIfNotExists({
    title: '农夫山泉 天然矿泉水 550ml×24瓶', slug: 'nongfu-spring-water-24',
    description: '农夫山泉天然水，优质水源地，不含任何添加剂',
    brand: '农夫山泉', categoryId: getCatId('drinks'),
    minPrice: '29.90', maxPrice: '29.90', totalSales: randInt(4000, 5000),
    imageUrls: [cdnImg('groceries/water/1.webp'), cdnImg('groceries/juice/1.webp')],
    skuList: [
      { code: 'NFS-550-24', price: '29.90', comparePrice: '39.90', stock: 500, attributes: { spec: '550ml×24瓶' } },
    ],
  });

  await insertProductIfNotExists({
    title: '精品咖啡豆 哥伦比亚单一产区', slug: 'premium-coffee-colombia',
    description: '哥伦比亚单一产区精品咖啡豆，中深烘焙，坚果巧克力风味',
    brand: 'BeanMaster', categoryId: getCatId('drinks'),
    minPrice: '68.00', maxPrice: '128.00', totalSales: randInt(800, 2500),
    imageUrls: [cdnImg('groceries/nescafe-coffee/1.webp'), cdnImg('groceries/ice-cream/1.webp')],
    skuList: [
      { code: 'COFFEE-200G', price: '68.00', comparePrice: '88.00', stock: 200, attributes: { weight: '200g', roast: '中深烘焙' } },
      { code: 'COFFEE-500G', price: '128.00', comparePrice: '158.00', stock: 150, attributes: { weight: '500g', roast: '中深烘焙' } },
    ],
  });

  await insertProductIfNotExists({
    title: '智利进口车厘子 JJ级 2斤装', slug: 'chile-cherry-jj-2lb',
    description: '智利进口车厘子，JJ级大果，果径28-30mm，新鲜空运直达',
    brand: '鲜果时光', categoryId: getCatId('fresh'),
    minPrice: '129.00', maxPrice: '129.00', totalSales: randInt(1500, 3000),
    imageUrls: [cdnImg('groceries/strawberry/1.webp'), cdnImg('groceries/kiwi/1.webp')],
    skuList: [
      { code: 'CHERRY-JJ-2LB', price: '129.00', comparePrice: '169.00', stock: 80, lowStock: 10, attributes: { spec: '2斤装', grade: 'JJ级' } },
    ],
  });

  // 美妆个护
  await insertProductIfNotExists({
    title: 'SK-II 神仙水 护肤精华露 230ml', slug: 'skii-facial-treatment-essence',
    description: 'SK-II 神仙水，93.4% PITERA精华，改善肤质，提亮肤色',
    brand: 'SK-II', categoryId: getCatId('skincare'),
    minPrice: '1370.00', maxPrice: '1370.00', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('skin-care/olay-ultra-moisture-shea-butter-body-wash/1.webp'), cdnImg('skin-care/olay-ultra-moisture-shea-butter-body-wash/2.webp')],
    skuList: [
      { code: 'SKII-FTE-230', price: '1370.00', comparePrice: '1590.00', stock: 200, attributes: { spec: '230ml' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'MAC 魅可 子弹头口红', slug: 'mac-lipstick-bullet',
    description: 'MAC 经典子弹头口红，高饱和色彩，丝缎质地，持久不脱色',
    brand: 'MAC', categoryId: getCatId('makeup'),
    minPrice: '230.00', maxPrice: '230.00', totalSales: randInt(2500, 5000),
    imageUrls: [cdnImg('beauty/red-lipstick/1.webp'), cdnImg('beauty/eyeshadow-palette-with-mirror/1.webp')],
    skuList: [
      { code: 'MAC-LS-RUBY', price: '230.00', comparePrice: '270.00', stock: 300, attributes: { color: 'Ruby Woo', finish: '哑光' } },
      { code: 'MAC-LS-CHILI', price: '230.00', comparePrice: '270.00', stock: 250, attributes: { color: 'Chili', finish: '哑光' } },
      { code: 'MAC-LS-VELVET', price: '230.00', comparePrice: '270.00', stock: 200, attributes: { color: 'Velvet Teddy', finish: '哑光' } },
    ],
  });

  await insertProductIfNotExists({
    title: '欧莱雅 玻尿酸洗发水 700ml', slug: 'loreal-hyaluronic-shampoo',
    description: '欧莱雅透明质酸洗发水，深层补水，柔顺亮泽，无硅油配方',
    brand: "L'Oreal", categoryId: getCatId('wash-care'),
    minPrice: '69.90', maxPrice: '69.90', totalSales: randInt(3000, 5000),
    imageUrls: [cdnImg('skin-care/vaseline-men-body-and-face-lotion/1.webp'), cdnImg('skin-care/attitude-super-leaves-hand-soap/1.webp')],
    skuList: [
      { code: 'LOREAL-HA-SH-700', price: '69.90', comparePrice: '89.90', stock: 400, attributes: { spec: '700ml', type: '柔顺型' } },
    ],
  });

  // 图书音像
  await insertProductIfNotExists({
    title: '三体（全三册）刘慈欣', slug: 'three-body-problem-trilogy',
    description: '刘慈欣科幻巨著，雨果奖获奖作品，中国科幻里程碑',
    brand: '重庆出版社', categoryId: getCatId('literature'),
    minPrice: '93.00', maxPrice: '93.00', totalSales: randInt(4000, 5000),
    imageUrls: [placeholderImg('Three+Body', '1E1B4B', 'E0E7FF'), placeholderImg('Dark+Forest', '312E81', 'C7D2FE')],
    skuList: [
      { code: 'SANTI-3BOOK', price: '93.00', comparePrice: '168.00', stock: 500, attributes: { version: '典藏版', format: '纸质书' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'JavaScript高级程序设计 第4版', slug: 'professional-javascript-4th',
    description: '红宝书，前端开发必读经典，全面覆盖ES6+特性',
    brand: '人民邮电出版社', categoryId: getCatId('education'),
    minPrice: '99.00', maxPrice: '99.00', totalSales: randInt(1500, 3000),
    imageUrls: [placeholderImg('JavaScript', 'FEF08A', '854D0E'), placeholderImg('ES6+', 'FDE047', '713F12')],
    skuList: [
      { code: 'PROJS-4TH', price: '99.00', comparePrice: '129.00', stock: 300, attributes: { version: '第4版', format: '纸质书' } },
    ],
  });

  await insertProductIfNotExists({
    title: '海贼王 航海王漫画 1-106卷', slug: 'one-piece-manga-1-106',
    description: '尾田荣一郎经典漫画，全球累计发行超5亿册',
    brand: '浙江人民美术出版社', categoryId: getCatId('comic'),
    minPrice: '5.90', maxPrice: '1999.00', totalSales: randInt(2000, 5000),
    imageUrls: [placeholderImg('One+Piece', 'DC2626', 'FEF2F2'), placeholderImg('Luffy', 'B91C1C', 'FEE2E2')],
    skuList: [
      { code: 'OP-SINGLE', price: '5.90', comparePrice: '7.90', stock: 500, attributes: { spec: '单册', format: '漫画' } },
      { code: 'OP-BOX-1-106', price: '1999.00', comparePrice: '2499.00', stock: 50, lowStock: 10, attributes: { spec: '全套1-106卷', format: '漫画' } },
    ],
  });

  // 运动户外
  await insertProductIfNotExists({
    title: 'Keep 智能动感单车 C1', slug: 'keep-smart-bike-c1',
    description: 'Keep 智能动感单车，磁控阻力，AI私教课程，静音飞轮',
    brand: 'Keep', categoryId: getCatId('fitness'),
    minPrice: '1999.00', maxPrice: '1999.00', totalSales: randInt(500, 2000),
    imageUrls: [placeholderImg('Keep+Bike', '0D9488', 'F0FDFA'), placeholderImg('Smart+Bike', '115E59', 'CCFBF1'), placeholderImg('AI+Coach', '134E4A', 'D1FAE5')],
    skuList: [
      { code: 'KEEP-C1-WHT', price: '1999.00', comparePrice: '2499.00', stock: 80, attributes: { color: '白色' } },
    ],
  });

  await insertProductIfNotExists({
    title: '北面 The North Face 冲锋衣 男款', slug: 'tnf-gore-tex-jacket-men',
    description: 'The North Face GORE-TEX 冲锋衣，防水防风透气，户外徒步必备',
    brand: 'The North Face', categoryId: getCatId('outdoor'),
    minPrice: '1999.00', maxPrice: '1999.00', totalSales: randInt(800, 2500),
    imageUrls: [placeholderImg('GORE-TEX', '166534', 'F0FDF4'), placeholderImg('TNF+Jacket', '14532D', 'DCFCE7')],
    skuList: [
      { code: 'TNF-GTX-M-M-BLK', price: '1999.00', comparePrice: '2599.00', stock: 100, attributes: { size: 'M', color: '黑色' } },
      { code: 'TNF-GTX-M-L-BLK', price: '1999.00', comparePrice: '2599.00', stock: 120, attributes: { size: 'L', color: '黑色' } },
      { code: 'TNF-GTX-M-XL-NVY', price: '1999.00', comparePrice: '2599.00', stock: 80, attributes: { size: 'XL', color: '藏青' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'Nike Air Zoom Pegasus 40 跑鞋', slug: 'nike-pegasus-40',
    description: 'Nike 飞马40，Air Zoom 气垫，React 泡棉，日常训练跑鞋',
    brand: 'Nike', categoryId: getCatId('sportswear'),
    minPrice: '699.00', maxPrice: '699.00', totalSales: randInt(2000, 4500),
    imageUrls: [cdnImg('mens-shoes/nike-air-jordan-1-red-and-black/1.webp'), cdnImg('mens-shoes/nike-air-jordan-1-red-and-black/2.webp')],
    skuList: [
      { code: 'PEG40-41-BLK', price: '699.00', comparePrice: '899.00', stock: 150, attributes: { size: '41', color: '黑白' } },
      { code: 'PEG40-42-BLK', price: '699.00', comparePrice: '899.00', stock: 200, attributes: { size: '42', color: '黑白' } },
      { code: 'PEG40-43-BLU', price: '699.00', comparePrice: '899.00', stock: 130, attributes: { size: '43', color: '蓝白' } },
    ],
  });

  // 家居家装
  await insertProductIfNotExists({
    title: '源氏木语 实木书桌 1.2m', slug: 'genji-solid-wood-desk-120',
    description: '北美白橡木实木书桌，简约日式风格，榫卯工艺，环保水性漆',
    brand: '源氏木语', categoryId: getCatId('furniture'),
    minPrice: '1599.00', maxPrice: '1999.00', totalSales: randInt(500, 1500),
    imageUrls: [cdnImg('furniture/bedside-table-african-cherry/1.webp'), cdnImg('furniture/bedside-table-african-cherry/2.webp'), cdnImg('furniture/bedside-table-african-cherry/3.webp')],
    skuList: [
      { code: 'GENJI-DESK-120', price: '1599.00', comparePrice: '1999.00', stock: 60, attributes: { size: '120x60cm', material: '白橡木' } },
      { code: 'GENJI-DESK-140', price: '1999.00', comparePrice: '2399.00', stock: 50, attributes: { size: '140x70cm', material: '白橡木' } },
    ],
  });

  await insertProductIfNotExists({
    title: '富安娜 100支长绒棉四件套', slug: 'fuanna-100s-cotton-bedding',
    description: '富安娜100支新疆长绒棉四件套，丝滑亲肤，高端轻奢床品',
    brand: '富安娜', categoryId: getCatId('bedding'),
    minPrice: '899.00', maxPrice: '899.00', totalSales: randInt(1000, 3000),
    imageUrls: [cdnImg('furniture/annibale-colombo-bed/1.webp'), cdnImg('furniture/annibale-colombo-bed/2.webp')],
    skuList: [
      { code: 'FUANNA-4PC-1.5-WHT', price: '899.00', comparePrice: '1299.00', stock: 100, attributes: { size: '1.5m床', color: '珍珠白' } },
      { code: 'FUANNA-4PC-1.8-GRY', price: '899.00', comparePrice: '1299.00', stock: 120, attributes: { size: '1.8m床', color: '高级灰' } },
    ],
  });

  await insertProductIfNotExists({
    title: '天马收纳箱 可叠加大号 3个装', slug: 'tenma-storage-box-3pack',
    description: '天马收纳箱，PP材质，透明可视，可叠加，衣物换季收纳',
    brand: '天马', categoryId: getCatId('storage'),
    minPrice: '99.00', maxPrice: '159.00', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('home-decoration/house-showpiece-plant/1.webp'), cdnImg('home-decoration/plant-pot/1.webp')],
    skuList: [
      { code: 'TENMA-56L-3PK', price: '99.00', comparePrice: '129.00', stock: 300, attributes: { spec: '56L×3个', color: '透明' } },
      { code: 'TENMA-78L-3PK', price: '159.00', comparePrice: '199.00', stock: 200, attributes: { spec: '78L×3个', color: '透明' } },
    ],
  });

  // 母婴玩具
  await insertProductIfNotExists({
    title: '飞鹤 星飞帆 婴幼儿配方奶粉 3段 700g', slug: 'firmus-starship-stage3',
    description: '飞鹤星飞帆3段，适合1-3岁宝宝，新鲜生牛乳一次成粉',
    brand: '飞鹤', categoryId: getCatId('milk-powder'),
    minPrice: '236.00', maxPrice: '436.00', totalSales: randInt(3000, 5000),
    imageUrls: [cdnImg('groceries/milk/1.webp'), cdnImg('groceries/protein-powder/1.webp')],
    skuList: [
      { code: 'FIRMUS-S3-700', price: '236.00', comparePrice: '278.00', stock: 300, attributes: { spec: '700g', stage: '3段' } },
      { code: 'FIRMUS-S3-700x2', price: '436.00', comparePrice: '556.00', stock: 200, attributes: { spec: '700g×2罐', stage: '3段' } },
    ],
  });

  await insertProductIfNotExists({
    title: '花王 妙而舒 婴儿纸尿裤 L54片', slug: 'merries-diaper-l54',
    description: '花王妙而舒纸尿裤，三层透气设计，柔软触感，干爽不闷',
    brand: '花王', categoryId: getCatId('diapers'),
    minPrice: '109.00', maxPrice: '199.00', totalSales: randInt(2000, 5000),
    imageUrls: [placeholderImg('Merries+L', 'FEF3C7', 'B45309'), placeholderImg('Merries+XL', 'FDE68A', '92400E')],
    skuList: [
      { code: 'MERRIES-L-54', price: '109.00', comparePrice: '139.00', stock: 400, attributes: { size: 'L', spec: '54片' } },
      { code: 'MERRIES-XL-44', price: '109.00', comparePrice: '139.00', stock: 350, attributes: { size: 'XL', spec: '44片' } },
      { code: 'MERRIES-L-108', price: '199.00', comparePrice: '259.00', stock: 200, attributes: { size: 'L', spec: '108片(2包)' } },
    ],
  });

  await insertProductIfNotExists({
    title: '乐高 LEGO 机械组 布加迪 42151', slug: 'lego-technic-bugatti-42151',
    description: '乐高机械组布加迪跑车，905片零件，可动引擎和变速箱',
    brand: 'LEGO', categoryId: getCatId('toys'),
    minPrice: '349.00', maxPrice: '349.00', totalSales: randInt(800, 2500),
    imageUrls: [placeholderImg('LEGO+Bugatti', 'DC2626', 'FEF2F2'), placeholderImg('LEGO+42151', 'B91C1C', 'FEE2E2'), placeholderImg('905+Pieces', '991B1B', 'FECACA')],
    skuList: [
      { code: 'LEGO-42151', price: '349.00', comparePrice: '449.00', stock: 150, lowStock: 10, attributes: { pieces: '905', age: '9+' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'B.Duck 小黄鸭 儿童滑板车', slug: 'bduck-kids-scooter',
    description: 'B.Duck 小黄鸭儿童三轮滑板车，可折叠，可调节高度，闪光轮',
    brand: 'B.Duck', categoryId: getCatId('toys'),
    minPrice: '199.00', maxPrice: '199.00', totalSales: randInt(1000, 3000),
    imageUrls: [placeholderImg('B.Duck+Scooter', 'FACC15', '422006'), placeholderImg('Kids+Scooter', 'EAB308', '3F3700')],
    skuList: [
      { code: 'BDUCK-SCOOT-YLW', price: '199.00', comparePrice: '269.00', stock: 200, attributes: { color: '黄色', ageRange: '3-8岁' } },
      { code: 'BDUCK-SCOOT-PNK', price: '199.00', comparePrice: '269.00', stock: 150, attributes: { color: '粉色', ageRange: '3-8岁' } },
    ],
  });

  // ══════════════════════════════════════════════════════════════
  // 新增商品 — 补充各分类至 3~4 个
  // ══════════════════════════════════════════════════════════════

  // ── 手机数码 · 耳机 ──
  await insertProductIfNotExists({
    title: '华为 FreeBuds Pro 3 真无线耳机', slug: 'huawei-freebuds-pro-3',
    description: '华为 FreeBuds Pro 3，星闪连接，智慧降噪3.0，LDAC高清音质',
    brand: '华为', categoryId: getCatId('earphones'),
    minPrice: '1199.00', maxPrice: '1199.00', totalSales: randInt(1500, 4000),
    imageUrls: [cdnImg('mobile-accessories/amazon-echo-dot-5th-generation/1.webp'), cdnImg('mobile-accessories/amazon-echo-dot-5th-generation/2.webp')],
    skuList: [
      { code: 'HW-FBP3-WHT', price: '1199.00', comparePrice: '1499.00', stock: 200, attributes: { color: '陶瓷白' } },
      { code: 'HW-FBP3-GRN', price: '1199.00', comparePrice: '1499.00', stock: 150, attributes: { color: '雅川青' } },
    ],
  });

  // ── 手机数码 · 智能手表 ──
  await insertProductIfNotExists({
    title: '华为 Watch GT 4 46mm', slug: 'huawei-watch-gt4-46',
    description: '华为 Watch GT 4，八角形设计，14天超长续航，心率血氧监测',
    brand: '华为', categoryId: getCatId('smart-watches'),
    minPrice: '1488.00', maxPrice: '1688.00', totalSales: randInt(1000, 3000),
    imageUrls: [cdnImg('mens-watches/brown-leather-belt-watch/1.webp'), cdnImg('mens-watches/brown-leather-belt-watch/2.webp')],
    skuList: [
      { code: 'HWGT4-46-BLK', price: '1488.00', comparePrice: '1688.00', stock: 150, attributes: { size: '46mm', band: '黑色氟橡胶' } },
      { code: 'HWGT4-46-BRN', price: '1688.00', comparePrice: '1888.00', stock: 100, attributes: { size: '46mm', band: '棕色真皮' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'Samsung Galaxy Watch6 Classic', slug: 'samsung-galaxy-watch6-classic',
    description: '三星 Galaxy Watch6 Classic，旋转表圈，BioActive传感器，WearOS',
    brand: 'Samsung', categoryId: getCatId('smart-watches'),
    minPrice: '2199.00', maxPrice: '2799.00', totalSales: randInt(500, 2000),
    imageUrls: [cdnImg('mens-watches/long-moonlight-necklace/1.webp'), cdnImg('mens-watches/round-silver-analog-watch/1.webp')],
    skuList: [
      { code: 'GW6C-43-SLV', price: '2199.00', comparePrice: '2599.00', stock: 100, attributes: { size: '43mm', color: '银色' } },
      { code: 'GW6C-47-BLK', price: '2799.00', comparePrice: '3199.00', stock: 80, attributes: { size: '47mm', color: '黑色' } },
    ],
  });

  // ── 电脑办公 · 笔记本 ──
  await insertProductIfNotExists({
    title: '华硕 ROG 幻16 游戏本', slug: 'asus-rog-zephyrus-g16',
    description: '华硕 ROG 幻16，i9-13900H + RTX4070，16英寸2K 240Hz电竞屏',
    brand: 'ASUS', categoryId: getCatId('laptops'),
    minPrice: '11999.00', maxPrice: '14999.00', totalSales: randInt(500, 2000),
    imageUrls: [cdnImg('laptops/asus-zenbook-pro-dual-screen-laptop/1.webp'), cdnImg('laptops/asus-zenbook-pro-dual-screen-laptop/2.webp'), cdnImg('laptops/asus-zenbook-pro-dual-screen-laptop/3.webp')],
    skuList: [
      { code: 'ROG-G16-4060', price: '11999.00', comparePrice: '13499.00', stock: 80, attributes: { gpu: 'RTX4060', memory: '16GB', storage: '512GB' } },
      { code: 'ROG-G16-4070', price: '14999.00', comparePrice: '16999.00', stock: 50, lowStock: 10, attributes: { gpu: 'RTX4070', memory: '32GB', storage: '1TB' } },
    ],
  });

  // ── 电脑办公 · 平板 ──
  await insertProductIfNotExists({
    title: 'Samsung Galaxy Tab S9 Ultra', slug: 'samsung-galaxy-tab-s9-ultra',
    description: '三星 Galaxy Tab S9 Ultra，14.6英寸 AMOLED，骁龙8 Gen2，S Pen',
    brand: 'Samsung', categoryId: getCatId('tablets'),
    minPrice: '8999.00', maxPrice: '10999.00', totalSales: randInt(300, 1500),
    imageUrls: [cdnImg('tablets/samsung-galaxy-tab-s7-plus-midnight-black/1.webp'), cdnImg('tablets/samsung-galaxy-tab-s7-plus-midnight-black/2.webp')],
    skuList: [
      { code: 'TABS9U-256-GRY', price: '8999.00', comparePrice: '9999.00', stock: 60, attributes: { storage: '256GB', color: '石墨灰' } },
      { code: 'TABS9U-512-BEG', price: '10999.00', comparePrice: '11999.00', stock: 40, lowStock: 10, attributes: { storage: '512GB', color: '奶油白' } },
    ],
  });

  // ── 电脑办公 · 键盘鼠标 ──
  await insertProductIfNotExists({
    title: '罗技 MX Keys S 无线键盘', slug: 'logitech-mx-keys-s',
    description: '罗技 MX Keys S，智能背光，多设备切换，低噪静音输入',
    brand: 'Logitech', categoryId: getCatId('keyboards'),
    minPrice: '699.00', maxPrice: '699.00', totalSales: randInt(1000, 3000),
    imageUrls: [placeholderImg('MX+Keys+S', '1F2937', 'F3F4F6'), placeholderImg('Logitech+MX', '111827', 'E5E7EB')],
    skuList: [
      { code: 'MXKEYS-S-BLK', price: '699.00', comparePrice: '849.00', stock: 200, attributes: { color: '石墨', layout: '全尺寸' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'Keychron K3 Pro 超薄机械键盘', slug: 'keychron-k3-pro',
    description: 'Keychron K3 Pro，75%布局，Gateron矮轴，蓝牙/有线双模',
    brand: 'Keychron', categoryId: getCatId('keyboards'),
    minPrice: '549.00', maxPrice: '549.00', totalSales: randInt(500, 2000),
    imageUrls: [placeholderImg('K3+Pro', '374151', 'F9FAFB'), placeholderImg('Keychron', '1F2937', 'F3F4F6')],
    skuList: [
      { code: 'KC-K3P-RED', price: '549.00', comparePrice: '649.00', stock: 120, attributes: { switch: '红轴', backlight: 'RGB' } },
      { code: 'KC-K3P-BRN', price: '549.00', comparePrice: '649.00', stock: 100, attributes: { switch: '茶轴', backlight: 'RGB' } },
    ],
  });

  // ── 家用电器 · 冰箱洗衣机 ──
  await insertProductIfNotExists({
    title: '西门子 10公斤滚筒洗衣机 WG54B2X00W', slug: 'siemens-washer-wg54b2',
    description: '西门子10kg滚筒洗衣机，1400转变频，智能除渍，15分钟快洗',
    brand: '西门子', categoryId: getCatId('big-appliance'),
    minPrice: '4999.00', maxPrice: '4999.00', totalSales: randInt(500, 1500),
    imageUrls: [placeholderImg('Siemens+Washer', '60A5FA', 'FFF'), placeholderImg('10kg+Drum', '3B82F6', 'FFF')],
    skuList: [
      { code: 'SIEM-WG54B-WHT', price: '4999.00', comparePrice: '5999.00', stock: 40, lowStock: 10, attributes: { color: '白色', capacity: '10kg' } },
    ],
  });

  await insertProductIfNotExists({
    title: '美的 1.5匹一级变频空调 KFR-35GW', slug: 'midea-ac-kfr35gw',
    description: '美的新一级能效变频空调，急速冷暖，智能WiFi控制，静音运行',
    brand: '美的', categoryId: getCatId('big-appliance'),
    minPrice: '2699.00', maxPrice: '2699.00', totalSales: randInt(1000, 3000),
    imageUrls: [placeholderImg('Midea+AC', '38BDF8', 'FFF'), placeholderImg('1.5P+AC', '0EA5E9', 'FFF')],
    skuList: [
      { code: 'MIDEA-AC-35-WHT', price: '2699.00', comparePrice: '3299.00', stock: 80, attributes: { power: '1.5匹', energy: '一级能效' } },
    ],
  });

  // ── 家用电器 · 小家电 ──
  await insertProductIfNotExists({
    title: '石头 G20 扫拖机器人', slug: 'roborock-g20',
    description: '石头 G20，全能基站，自清洁拖布，6000Pa大吸力，LDS激光导航',
    brand: '石头', categoryId: getCatId('small-appliance'),
    minPrice: '3999.00', maxPrice: '3999.00', totalSales: randInt(800, 2500),
    imageUrls: [placeholderImg('Roborock+G20', '4B5563', 'F9FAFB'), placeholderImg('Robot+Vacuum', '374151', 'F3F4F6')],
    skuList: [
      { code: 'ROBO-G20-WHT', price: '3999.00', comparePrice: '4799.00', stock: 60, attributes: { color: '曙光白' } },
    ],
  });

  // ── 家用电器 · 厨房电器 ──
  await insertProductIfNotExists({
    title: '九阳 破壁豆浆机 Y1 Plus', slug: 'joyoung-y1-plus',
    description: '九阳破壁豆浆机，自清洗免手洗，不用泡豆，8大功能',
    brand: '九阳', categoryId: getCatId('kitchen-appliance'),
    minPrice: '1299.00', maxPrice: '1299.00', totalSales: randInt(1500, 4000),
    imageUrls: [cdnImg('kitchen-accessories/electric-stove/2.webp'), cdnImg('kitchen-accessories/electric-stove/3.webp')],
    skuList: [
      { code: 'JY-Y1P-WHT', price: '1299.00', comparePrice: '1599.00', stock: 100, attributes: { color: '白色', capacity: '1.2L' } },
    ],
  });

  await insertProductIfNotExists({
    title: '松下 变频微波炉 NN-DS59MB', slug: 'panasonic-microwave-ds59',
    description: '松下变频微波炉，27L容量，蒸烤炸一体，一级能效',
    brand: '松下', categoryId: getCatId('kitchen-appliance'),
    minPrice: '1699.00', maxPrice: '1699.00', totalSales: randInt(500, 2000),
    imageUrls: [cdnImg('kitchen-accessories/silver-pot-with-glass-cap/2.webp'), cdnImg('kitchen-accessories/silver-pot-with-glass-cap/3.webp')],
    skuList: [
      { code: 'PANA-MW-59-BLK', price: '1699.00', comparePrice: '1999.00', stock: 60, attributes: { color: '黑色', capacity: '27L' } },
    ],
  });

  // ── 服饰鞋包 · 男装 ──
  await insertProductIfNotExists({
    title: 'Ralph Lauren 经典Polo衫 男款', slug: 'ralph-lauren-polo-shirt-men',
    description: 'Ralph Lauren 经典小马标Polo衫，网眼棉面料，休闲商务两穿',
    brand: 'Ralph Lauren', categoryId: getCatId('menswear'),
    minPrice: '799.00', maxPrice: '799.00', totalSales: randInt(1000, 3000),
    imageUrls: [cdnImg('mens-shirts/man-plaid-shirt/1.webp'), cdnImg('mens-shirts/man-plaid-shirt/2.webp')],
    skuList: [
      { code: 'RL-POLO-M-NVY', price: '799.00', comparePrice: '990.00', stock: 150, attributes: { size: 'M', color: '藏青' } },
      { code: 'RL-POLO-L-WHT', price: '799.00', comparePrice: '990.00', stock: 120, attributes: { size: 'L', color: '白色' } },
      { code: 'RL-POLO-XL-RED', price: '799.00', comparePrice: '990.00', stock: 100, attributes: { size: 'XL', color: '红色' } },
    ],
  });

  // ── 服饰鞋包 · 女装 ──
  await insertProductIfNotExists({
    title: '太平鸟 女式西装外套 通勤款', slug: 'peacebird-blazer-women',
    description: '太平鸟西装外套，垂坠感面料，修身剪裁，通勤穿搭必备',
    brand: '太平鸟', categoryId: getCatId('womenswear'),
    minPrice: '599.00', maxPrice: '599.00', totalSales: randInt(1000, 3000),
    imageUrls: [cdnImg('tops/womans-black-top/1.webp'), cdnImg('tops/womans-black-top/2.webp')],
    skuList: [
      { code: 'PB-BLZ-W-S-BLK', price: '599.00', comparePrice: '799.00', stock: 120, attributes: { size: 'S', color: '黑色' } },
      { code: 'PB-BLZ-W-M-KHK', price: '599.00', comparePrice: '799.00', stock: 150, attributes: { size: 'M', color: '卡其' } },
      { code: 'PB-BLZ-W-L-BLK', price: '599.00', comparePrice: '799.00', stock: 100, attributes: { size: 'L', color: '黑色' } },
    ],
  });

  // ── 服饰鞋包 · 鞋靴 ──
  await insertProductIfNotExists({
    title: 'New Balance 574 经典复古跑鞋', slug: 'new-balance-574-classic',
    description: 'New Balance 574，经典复古鞋型，ENCAP中底缓震，百搭不过时',
    brand: 'New Balance', categoryId: getCatId('shoes'),
    minPrice: '769.00', maxPrice: '769.00', totalSales: randInt(1500, 4000),
    imageUrls: [cdnImg('mens-shoes/nike-baseball-cleats/1.webp'), cdnImg('mens-shoes/nike-baseball-cleats/2.webp')],
    skuList: [
      { code: 'NB574-40-GRY', price: '769.00', comparePrice: '899.00', stock: 120, attributes: { size: '40', color: '元祖灰' } },
      { code: 'NB574-42-GRY', price: '769.00', comparePrice: '899.00', stock: 150, attributes: { size: '42', color: '元祖灰' } },
      { code: 'NB574-43-NVY', price: '769.00', comparePrice: '899.00', stock: 100, attributes: { size: '43', color: '藏青' } },
    ],
  });

  await insertProductIfNotExists({
    title: '匡威 Chuck Taylor All Star 经典帆布鞋', slug: 'converse-chuck-taylor-classic',
    description: '匡威 Chuck Taylor All Star，经典高帮帆布鞋，时尚百搭',
    brand: 'Converse', categoryId: getCatId('shoes'),
    minPrice: '499.00', maxPrice: '499.00', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('mens-shoes/lace-up-boots/1.webp'), cdnImg('mens-shoes/lace-up-boots/2.webp')],
    skuList: [
      { code: 'CVS-CT-38-BLK', price: '499.00', comparePrice: '599.00', stock: 200, attributes: { size: '38', color: '黑色' } },
      { code: 'CVS-CT-40-WHT', price: '499.00', comparePrice: '599.00', stock: 250, attributes: { size: '40', color: '白色' } },
      { code: 'CVS-CT-42-RED', price: '499.00', comparePrice: '599.00', stock: 180, attributes: { size: '42', color: '红色' } },
    ],
  });

  // ── 食品生鲜 · 零食 ──
  await insertProductIfNotExists({
    title: '良品铺子 鸭脖鸭锁骨 卤味零食大礼包', slug: 'bestore-duck-neck-gift-box',
    description: '良品铺子卤味零食大礼包，鸭脖鸭锁骨鸭翅组合，麻辣鲜香',
    brand: '良品铺子', categoryId: getCatId('snacks'),
    minPrice: '59.90', maxPrice: '99.90', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('groceries/beef-steak/1.webp'), cdnImg('groceries/chicken-meat/1.webp')],
    skuList: [
      { code: 'LPPZ-DUCK-S', price: '59.90', comparePrice: '79.90', stock: 300, attributes: { spec: '小份装 400g' } },
      { code: 'LPPZ-DUCK-L', price: '99.90', comparePrice: '129.90', stock: 200, attributes: { spec: '大礼包 800g' } },
    ],
  });

  await insertProductIfNotExists({
    title: '百草味 芒果干 蜜饯果脯 500g', slug: 'baicaowei-dried-mango-500',
    description: '百草味芒果干，精选泰国芒果，软糯香甜，独立小包装',
    brand: '百草味', categoryId: getCatId('snacks'),
    minPrice: '29.90', maxPrice: '49.90', totalSales: randInt(3000, 5000),
    imageUrls: [cdnImg('groceries/apple/1.webp'), cdnImg('groceries/cat-food/1.webp')],
    skuList: [
      { code: 'BCW-MANGO-250', price: '29.90', comparePrice: '39.90', stock: 400, attributes: { spec: '250g' } },
      { code: 'BCW-MANGO-500', price: '49.90', comparePrice: '69.90', stock: 300, attributes: { spec: '500g' } },
    ],
  });

  // ── 食品生鲜 · 饮料 ──
  await insertProductIfNotExists({
    title: '元气森林 苏打气泡水 白桃味 480ml×15瓶', slug: 'genki-forest-sparkling-peach-15',
    description: '元气森林气泡水，0糖0脂0卡，白桃风味，清爽畅饮',
    brand: '元气森林', categoryId: getCatId('drinks'),
    minPrice: '59.90', maxPrice: '59.90', totalSales: randInt(3000, 5000),
    imageUrls: [cdnImg('groceries/juice/2.webp'), cdnImg('groceries/water/2.webp')],
    skuList: [
      { code: 'GKF-PEACH-15', price: '59.90', comparePrice: '74.90', stock: 400, attributes: { flavor: '白桃味', spec: '480ml×15瓶' } },
    ],
  });

  // ── 食品生鲜 · 生鲜 ──
  await insertProductIfNotExists({
    title: '丹东99草莓 新鲜水果 3斤装', slug: 'dandong-strawberry-3lb',
    description: '丹东99红颜草莓，当季新鲜采摘，个大饱满，香甜多汁',
    brand: '鲜果时光', categoryId: getCatId('fresh'),
    minPrice: '89.00', maxPrice: '89.00', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('groceries/strawberry/2.webp'), cdnImg('groceries/strawberry/3.webp')],
    skuList: [
      { code: 'DD99-SB-3LB', price: '89.00', comparePrice: '119.00', stock: 100, lowStock: 15, attributes: { spec: '3斤装', grade: '精选大果' } },
    ],
  });

  await insertProductIfNotExists({
    title: '厄瓜多尔白虾 冷冻大虾 净重4斤', slug: 'ecuador-white-shrimp-4lb',
    description: '厄瓜多尔进口白虾，30-40只/斤，肉质紧实弹牙，急冻锁鲜',
    brand: '海鲜汇', categoryId: getCatId('fresh'),
    minPrice: '149.00', maxPrice: '149.00', totalSales: randInt(1000, 3000),
    imageUrls: [cdnImg('groceries/salmon/1.webp'), cdnImg('groceries/fish-steak/1.webp')],
    skuList: [
      { code: 'EC-SHRIMP-4LB', price: '149.00', comparePrice: '199.00', stock: 80, lowStock: 10, attributes: { spec: '净重4斤', size: '30-40只/斤' } },
    ],
  });

  // ── 美妆个护 · 护肤 ──
  await insertProductIfNotExists({
    title: '兰蔻 小黑瓶精华肌底液 100ml', slug: 'lancome-advanced-genifique-100',
    description: '兰蔻小黑瓶，微生态护肤，修护肌肤屏障，焕亮好气色',
    brand: '兰蔻', categoryId: getCatId('skincare'),
    minPrice: '1080.00', maxPrice: '1080.00', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('skin-care/dove-body-care-nourishing-body-wash/1.webp'), cdnImg('skin-care/hemani-tea-tree-oil/1.webp')],
    skuList: [
      { code: 'LC-AGF-50', price: '760.00', comparePrice: '890.00', stock: 200, attributes: { spec: '50ml' } },
      { code: 'LC-AGF-100', price: '1080.00', comparePrice: '1260.00', stock: 150, attributes: { spec: '100ml' } },
    ],
  });

  await insertProductIfNotExists({
    title: '雅诗兰黛 小棕瓶眼霜 15ml', slug: 'estee-lauder-eye-cream-15',
    description: '雅诗兰黛小棕瓶眼霜，淡化细纹，提亮眼周，抗初老必备',
    brand: '雅诗兰黛', categoryId: getCatId('skincare'),
    minPrice: '520.00', maxPrice: '520.00', totalSales: randInt(1500, 4000),
    imageUrls: [cdnImg('skin-care/elf-skin-super-hydrate-moisturizer/1.webp'), cdnImg('skin-care/elf-skin-super-hydrate-moisturizer/2.webp')],
    skuList: [
      { code: 'EL-ANR-EYE-15', price: '520.00', comparePrice: '620.00', stock: 250, attributes: { spec: '15ml' } },
    ],
  });

  // ── 美妆个护 · 彩妆 ──
  await insertProductIfNotExists({
    title: '完美日记 动物眼影盘 小猫盘', slug: 'perfect-diary-cat-eyeshadow',
    description: '完美日记动物系列眼影盘，12色搭配，粉质细腻，持妆不飞粉',
    brand: '完美日记', categoryId: getCatId('makeup'),
    minPrice: '89.90', maxPrice: '89.90', totalSales: randInt(3000, 5000),
    imageUrls: [cdnImg('beauty/eyeshadow-palette-with-mirror/2.webp'), cdnImg('beauty/makeup-remover/1.webp')],
    skuList: [
      { code: 'PD-CAT-12', price: '89.90', comparePrice: '129.90', stock: 300, attributes: { palette: '小猫盘', colors: '12色' } },
    ],
  });

  await insertProductIfNotExists({
    title: '花西子 空气蜜粉 定妆散粉', slug: 'florasis-air-powder',
    description: '花西子空气蜜粉，超细粉质，控油定妆，轻薄透气如无物',
    brand: '花西子', categoryId: getCatId('makeup'),
    minPrice: '149.00', maxPrice: '149.00', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('beauty/powder-canister/1.webp'), cdnImg('beauty/powder-canister/2.webp')],
    skuList: [
      { code: 'FLR-AP-01', price: '149.00', comparePrice: '199.00', stock: 250, attributes: { shade: '01 自然色' } },
      { code: 'FLR-AP-02', price: '149.00', comparePrice: '199.00', stock: 200, attributes: { shade: '02 嫩肤色' } },
    ],
  });

  // ── 美妆个护 · 洗护 ──
  await insertProductIfNotExists({
    title: '潘婷 3分钟奇迹发膜 护发素 270ml', slug: 'pantene-3min-miracle-conditioner',
    description: '潘婷3分钟奇迹发膜，氨基酸修护，丝滑顺发，深层滋养',
    brand: '潘婷', categoryId: getCatId('wash-care'),
    minPrice: '39.90', maxPrice: '39.90', totalSales: randInt(2500, 5000),
    imageUrls: [cdnImg('skin-care/vaseline-men-body-and-face-lotion/2.webp'), cdnImg('skin-care/attitude-super-leaves-hand-soap/2.webp')],
    skuList: [
      { code: 'PANT-3MM-270', price: '39.90', comparePrice: '59.90', stock: 400, attributes: { spec: '270ml', type: '丝质顺滑型' } },
    ],
  });

  await insertProductIfNotExists({
    title: '舒肤佳 纯白清香沐浴露 1L', slug: 'safeguard-body-wash-1l',
    description: '舒肤佳沐浴露，12小时长效抑菌，温和配方，全家可用',
    brand: '舒肤佳', categoryId: getCatId('wash-care'),
    minPrice: '39.90', maxPrice: '39.90', totalSales: randInt(3000, 5000),
    imageUrls: [cdnImg('skin-care/neutrogena-norwegian-formula-hand-cream/1.webp'), cdnImg('skin-care/neutrogena-norwegian-formula-hand-cream/2.webp')],
    skuList: [
      { code: 'SFJ-BW-1L', price: '39.90', comparePrice: '59.90', stock: 500, attributes: { spec: '1L', fragrance: '纯白清香' } },
    ],
  });

  // ── 图书音像 · 文学 ──
  await insertProductIfNotExists({
    title: '活着（余华）', slug: 'to-live-yu-hua',
    description: '余华代表作，讲述人在苦难中的坚韧与温情，销量超2000万册',
    brand: '作家出版社', categoryId: getCatId('literature'),
    minPrice: '29.00', maxPrice: '29.00', totalSales: randInt(4000, 5000),
    imageUrls: [placeholderImg('To+Live', '1E3A5F', 'DBEAFE'), placeholderImg('Yu+Hua', '1E40AF', 'BFDBFE')],
    skuList: [
      { code: 'HUOZHE-PB', price: '29.00', comparePrice: '45.00', stock: 500, attributes: { format: '平装', version: '最新版' } },
    ],
  });

  await insertProductIfNotExists({
    title: '百年孤独（加西亚·马尔克斯）', slug: 'one-hundred-years-of-solitude',
    description: '马尔克斯代表作，魔幻现实主义文学巅峰，诺贝尔文学奖作品',
    brand: '南海出版公司', categoryId: getCatId('literature'),
    minPrice: '55.00', maxPrice: '55.00', totalSales: randInt(2000, 4000),
    imageUrls: [placeholderImg('Solitude', '5B21B6', 'F5F3FF'), placeholderImg('Marquez', '6D28D9', 'EDE9FE')],
    skuList: [
      { code: 'BNGD-50TH', price: '55.00', comparePrice: '69.80', stock: 400, attributes: { format: '精装', version: '50周年纪念版' } },
    ],
  });

  // ── 图书音像 · 教育 ──
  await insertProductIfNotExists({
    title: 'Python编程 从入门到实践 第3版', slug: 'python-crash-course-3rd',
    description: 'Python入门经典教材，项目驱动式学习，适合零基础读者',
    brand: '人民邮电出版社', categoryId: getCatId('education'),
    minPrice: '79.80', maxPrice: '79.80', totalSales: randInt(2000, 4000),
    imageUrls: [placeholderImg('Python', '3B82F6', 'DBEAFE'), placeholderImg('Crash+Course', '2563EB', 'BFDBFE')],
    skuList: [
      { code: 'PYCC-3RD', price: '79.80', comparePrice: '109.80', stock: 300, attributes: { format: '纸质书', edition: '第3版' } },
    ],
  });

  await insertProductIfNotExists({
    title: '高等数学（同济第七版）上下册', slug: 'advanced-math-tongji-7th',
    description: '同济大学数学系经典教材，高等院校通用，工科学生必备',
    brand: '高等教育出版社', categoryId: getCatId('education'),
    minPrice: '68.00', maxPrice: '68.00', totalSales: randInt(3000, 5000),
    imageUrls: [placeholderImg('Math', '059669', 'D1FAE5'), placeholderImg('Calculus', '047857', 'A7F3D0')],
    skuList: [
      { code: 'GDSX-7-SET', price: '68.00', comparePrice: '96.60', stock: 500, attributes: { format: '纸质书', spec: '上下册套装' } },
    ],
  });

  // ── 图书音像 · 漫画 ──
  await insertProductIfNotExists({
    title: '鬼灭之刃 漫画全套 1-23卷', slug: 'demon-slayer-manga-1-23',
    description: '吾峠呼世晴著，累计发行超1.5亿册，热血战斗漫画',
    brand: '浙江人民美术出版社', categoryId: getCatId('comic'),
    minPrice: '6.90', maxPrice: '299.00', totalSales: randInt(1500, 4000),
    imageUrls: [placeholderImg('Demon+Slayer', '166534', 'F0FDF4'), placeholderImg('Tanjiro', '15803D', 'DCFCE7')],
    skuList: [
      { code: 'GMMZR-SINGLE', price: '6.90', comparePrice: '9.90', stock: 500, attributes: { spec: '单册', format: '漫画' } },
      { code: 'GMMZR-BOX-1-23', price: '299.00', comparePrice: '399.00', stock: 80, lowStock: 10, attributes: { spec: '全套1-23卷', format: '漫画' } },
    ],
  });

  await insertProductIfNotExists({
    title: '进击的巨人 漫画全套 1-34卷', slug: 'attack-on-titan-manga-1-34',
    description: '谏山创著，暗黑奇幻巨作，揭开墙外世界的真相',
    brand: '新星出版社', categoryId: getCatId('comic'),
    minPrice: '6.90', maxPrice: '399.00', totalSales: randInt(1000, 3000),
    imageUrls: [placeholderImg('AoT', '78350F', 'FEF9C3'), placeholderImg('Titan', '854D0E', 'FEF08A')],
    skuList: [
      { code: 'AOT-SINGLE', price: '6.90', comparePrice: '9.90', stock: 500, attributes: { spec: '单册', format: '漫画' } },
      { code: 'AOT-BOX-1-34', price: '399.00', comparePrice: '499.00', stock: 50, lowStock: 10, attributes: { spec: '全套1-34卷', format: '漫画' } },
    ],
  });

  // ── 运动户外 · 健身器材 ──
  await insertProductIfNotExists({
    title: '小莫 包胶哑铃 可调节 20kg一对', slug: 'xiaomo-adjustable-dumbbell-20kg',
    description: '小莫可调节哑铃，环保包胶，防滑手柄，10档重量自由切换',
    brand: '小莫', categoryId: getCatId('fitness'),
    minPrice: '299.00', maxPrice: '499.00', totalSales: randInt(1000, 3000),
    imageUrls: [cdnImg('sports-accessories/football/1.webp'), cdnImg('sports-accessories/metal-bat/1.webp')],
    skuList: [
      { code: 'XM-DB-10KG', price: '299.00', comparePrice: '399.00', stock: 150, attributes: { weight: '10kg×2', material: '包胶' } },
      { code: 'XM-DB-20KG', price: '499.00', comparePrice: '599.00', stock: 100, attributes: { weight: '20kg×2', material: '包胶' } },
    ],
  });

  await insertProductIfNotExists({
    title: '悦步 瑜伽垫 加宽加厚 185×80cm', slug: 'yuebu-yoga-mat-185x80',
    description: '悦步TPE瑜伽垫，双面防滑，高回弹缓震，环保无味',
    brand: '悦步', categoryId: getCatId('fitness'),
    minPrice: '89.00', maxPrice: '129.00', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('sports-accessories/tennis-ball/1.webp'), cdnImg('sports-accessories/cricket-helmet/1.webp')],
    skuList: [
      { code: 'YB-YOGA-6MM', price: '89.00', comparePrice: '119.00', stock: 300, attributes: { thickness: '6mm', color: '藕粉' } },
      { code: 'YB-YOGA-8MM', price: '129.00', comparePrice: '159.00', stock: 200, attributes: { thickness: '8mm', color: '深紫' } },
    ],
  });

  // ── 运动户外 · 户外装备 ──
  await insertProductIfNotExists({
    title: '始祖鸟 Mantis 26 户外双肩包', slug: 'arcteryx-mantis-26-backpack',
    description: "Arc'teryx Mantis 26L，城市户外两用，轻量耐磨，多隔层收纳",
    brand: "Arc'teryx", categoryId: getCatId('outdoor'),
    minPrice: '1350.00', maxPrice: '1350.00', totalSales: randInt(500, 2000),
    imageUrls: [cdnImg('womens-bags/women-handbag-black/1.webp'), cdnImg('womens-bags/women-handbag-black/2.webp')],
    skuList: [
      { code: 'ARC-M26-BLK', price: '1350.00', comparePrice: '1600.00', stock: 80, lowStock: 10, attributes: { color: '黑色', capacity: '26L' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'Columbia 哥伦比亚 防水冲锋裤 男款', slug: 'columbia-waterproof-pants-men',
    description: 'Columbia Omni-Tech 防水冲锋裤，三层压胶，透气速干，登山徒步',
    brand: 'Columbia', categoryId: getCatId('outdoor'),
    minPrice: '799.00', maxPrice: '799.00', totalSales: randInt(500, 2000),
    imageUrls: [placeholderImg('Columbia+Pants', '065F46', 'ECFDF5'), placeholderImg('Waterproof', '047857', 'D1FAE5')],
    skuList: [
      { code: 'COL-WP-M-M', price: '799.00', comparePrice: '999.00', stock: 100, attributes: { size: 'M', color: '黑色' } },
      { code: 'COL-WP-M-L', price: '799.00', comparePrice: '999.00', stock: 120, attributes: { size: 'L', color: '黑色' } },
      { code: 'COL-WP-M-XL', price: '799.00', comparePrice: '999.00', stock: 80, attributes: { size: 'XL', color: '军绿' } },
    ],
  });

  // ── 运动户外 · 运动服饰 ──
  await insertProductIfNotExists({
    title: 'Under Armour 紧身压缩衣 男款', slug: 'under-armour-compression-shirt',
    description: 'Under Armour HeatGear 压缩衣，四向弹力，速干排汗，贴合运动',
    brand: 'Under Armour', categoryId: getCatId('sportswear'),
    minPrice: '299.00', maxPrice: '299.00', totalSales: randInt(1500, 4000),
    imageUrls: [cdnImg('mens-shirts/man-transition-jacket/1.webp'), cdnImg('mens-shirts/man-transition-jacket/2.webp')],
    skuList: [
      { code: 'UA-CMP-M-BLK', price: '299.00', comparePrice: '399.00', stock: 200, attributes: { size: 'M', color: '黑色' } },
      { code: 'UA-CMP-L-BLK', price: '299.00', comparePrice: '399.00', stock: 250, attributes: { size: 'L', color: '黑色' } },
      { code: 'UA-CMP-XL-NVY', price: '299.00', comparePrice: '399.00', stock: 150, attributes: { size: 'XL', color: '藏青' } },
    ],
  });

  await insertProductIfNotExists({
    title: '安踏 KT8 汤普森篮球鞋', slug: 'anta-kt8-basketball-shoes',
    description: '安踏 KT8 克莱·汤普森签名篮球鞋，氮科技中底，实战缓震',
    brand: '安踏', categoryId: getCatId('sportswear'),
    minPrice: '899.00', maxPrice: '899.00', totalSales: randInt(1000, 3000),
    imageUrls: [cdnImg('mens-shoes/puma-future-rider-trainers/1.webp'), cdnImg('mens-shoes/puma-future-rider-trainers/2.webp')],
    skuList: [
      { code: 'ANTA-KT8-41-WHT', price: '899.00', comparePrice: '1099.00', stock: 100, attributes: { size: '41', color: '白蓝' } },
      { code: 'ANTA-KT8-43-BLK', price: '899.00', comparePrice: '1099.00', stock: 120, attributes: { size: '43', color: '黑金' } },
    ],
  });

  // ── 家居家装 · 家具 ──
  await insertProductIfNotExists({
    title: '全友家居 布艺沙发 现代简约三人位', slug: 'quanyou-fabric-sofa-3seat',
    description: '全友布艺沙发，科技布面料，高回弹海绵，可拆洗设计',
    brand: '全友', categoryId: getCatId('furniture'),
    minPrice: '3299.00', maxPrice: '4299.00', totalSales: randInt(500, 1500),
    imageUrls: [cdnImg('furniture/wooden-bathroom-sink-with-mirror/1.webp'), cdnImg('furniture/wooden-bathroom-sink-with-mirror/2.webp')],
    skuList: [
      { code: 'QY-SOFA-3-GRY', price: '3299.00', comparePrice: '4199.00', stock: 30, lowStock: 5, attributes: { type: '三人位', color: '浅灰' } },
      { code: 'QY-SOFA-L-GRY', price: '4299.00', comparePrice: '5199.00', stock: 20, lowStock: 5, attributes: { type: 'L型转角', color: '浅灰' } },
    ],
  });

  await insertProductIfNotExists({
    title: '林氏家居 电视柜 现代简约 可伸缩', slug: 'linshi-tv-cabinet-retractable',
    description: '林氏家居电视柜，可伸缩设计，适配多种客厅尺寸，板材环保E0级',
    brand: '林氏家居', categoryId: getCatId('furniture'),
    minPrice: '899.00', maxPrice: '1299.00', totalSales: randInt(800, 2500),
    imageUrls: [cdnImg('furniture/bedside-table-african-cherry/4.webp'), cdnImg('home-decoration/decoration-swing/1.webp')],
    skuList: [
      { code: 'LS-TV-180-WHT', price: '899.00', comparePrice: '1199.00', stock: 50, attributes: { length: '180cm', color: '暖白' } },
      { code: 'LS-TV-240-WNT', price: '1299.00', comparePrice: '1599.00', stock: 30, attributes: { length: '240cm', color: '胡桃色' } },
    ],
  });

  // ── 家居家装 · 床上用品 ──
  await insertProductIfNotExists({
    title: '罗莱 桑蚕丝被 春秋被 200×230cm', slug: 'luolai-silk-quilt-200x230',
    description: '罗莱100%桑蚕丝被，亲肤透气，恒温舒适，四季可用',
    brand: '罗莱', categoryId: getCatId('bedding'),
    minPrice: '999.00', maxPrice: '1599.00', totalSales: randInt(500, 2000),
    imageUrls: [cdnImg('furniture/annibale-colombo-bed/3.webp'), cdnImg('furniture/annibale-colombo-bed/4.webp')],
    skuList: [
      { code: 'LL-SILK-S', price: '999.00', comparePrice: '1399.00', stock: 80, attributes: { weight: '春秋款 1斤', size: '200×230cm' } },
      { code: 'LL-SILK-W', price: '1599.00', comparePrice: '1999.00', stock: 50, attributes: { weight: '冬季款 2斤', size: '200×230cm' } },
    ],
  });

  await insertProductIfNotExists({
    title: '水星家纺 天然乳胶枕 泰国进口', slug: 'mercury-latex-pillow-thailand',
    description: '水星家纺泰国进口天然乳胶枕，波浪曲线，护颈支撑，抗菌防螨',
    brand: '水星家纺', categoryId: getCatId('bedding'),
    minPrice: '199.00', maxPrice: '359.00', totalSales: randInt(2000, 5000),
    imageUrls: [placeholderImg('Latex+Pillow', 'FCD34D', '78350F'), placeholderImg('Thailand+Latex', 'FBBF24', '92400E')],
    skuList: [
      { code: 'SX-LTX-STD', price: '199.00', comparePrice: '299.00', stock: 300, attributes: { type: '标准款', size: '60×40cm' } },
      { code: 'SX-LTX-PAIR', price: '359.00', comparePrice: '499.00', stock: 200, attributes: { type: '一对装', size: '60×40cm' } },
    ],
  });

  // ── 家居家装 · 收纳 ──
  await insertProductIfNotExists({
    title: '禧天龙 透明鞋盒 加厚 6个装', slug: 'citylong-shoe-box-6pack',
    description: '禧天龙透明鞋盒，磁吸开门，加厚PP材质，可叠加，节省空间',
    brand: '禧天龙', categoryId: getCatId('storage'),
    minPrice: '59.90', maxPrice: '99.90', totalSales: randInt(3000, 5000),
    imageUrls: [cdnImg('home-decoration/room-spray/1.webp'), cdnImg('home-decoration/room-spray/2.webp')],
    skuList: [
      { code: 'CTL-SHOE-6', price: '59.90', comparePrice: '79.90', stock: 400, attributes: { spec: '6个装', size: '标准款' } },
      { code: 'CTL-SHOE-12', price: '99.90', comparePrice: '139.90', stock: 250, attributes: { spec: '12个装', size: '标准款' } },
    ],
  });

  await insertProductIfNotExists({
    title: '太力 真空压缩收纳袋 电泵套装', slug: 'taili-vacuum-storage-bags-set',
    description: '太力真空压缩袋，食品级PA+PE材质，配电动抽气泵，换季收纳神器',
    brand: '太力', categoryId: getCatId('storage'),
    minPrice: '49.90', maxPrice: '89.90', totalSales: randInt(2000, 5000),
    imageUrls: [cdnImg('home-decoration/plant-pot/2.webp'), cdnImg('home-decoration/house-showpiece-plant/2.webp')],
    skuList: [
      { code: 'TL-VAC-8', price: '49.90', comparePrice: '69.90', stock: 300, attributes: { spec: '8袋+手泵' } },
      { code: 'TL-VAC-15P', price: '89.90', comparePrice: '119.90', stock: 200, attributes: { spec: '15袋+电泵' } },
    ],
  });

  // ── 母婴玩具 · 奶粉 ──
  await insertProductIfNotExists({
    title: '爱他美 卓萃白金版 3段 900g', slug: 'aptamil-profutura-stage3-900',
    description: '爱他美卓萃白金版3段，天然乳脂，精萃天然营养小分子，1-3岁',
    brand: '爱他美', categoryId: getCatId('milk-powder'),
    minPrice: '338.00', maxPrice: '618.00', totalSales: randInt(2000, 4000),
    imageUrls: [cdnImg('groceries/protein-powder/2.webp'), cdnImg('groceries/milk/2.webp')],
    skuList: [
      { code: 'APT-PRO-S3-900', price: '338.00', comparePrice: '398.00', stock: 200, attributes: { spec: '900g', stage: '3段' } },
      { code: 'APT-PRO-S3-900x2', price: '618.00', comparePrice: '796.00', stock: 150, attributes: { spec: '900g×2罐', stage: '3段' } },
    ],
  });

  await insertProductIfNotExists({
    title: '美赞臣 蓝臻 婴幼儿配方奶粉 2段 900g', slug: 'enfamil-enspire-stage2-900',
    description: '美赞臣蓝臻2段，含乳铁蛋白+MFGM乳脂球膜，接近母乳营养',
    brand: '美赞臣', categoryId: getCatId('milk-powder'),
    minPrice: '378.00', maxPrice: '378.00', totalSales: randInt(1500, 3500),
    imageUrls: [cdnImg('groceries/protein-powder/3.webp'), cdnImg('groceries/milk/3.webp')],
    skuList: [
      { code: 'MJC-LZ-S2-900', price: '378.00', comparePrice: '438.00', stock: 200, attributes: { spec: '900g', stage: '2段' } },
    ],
  });

  // ── 母婴玩具 · 纸尿裤 ──
  await insertProductIfNotExists({
    title: '好奇 铂金装 纸尿裤 L58片', slug: 'huggies-platinum-diaper-l58',
    description: '好奇铂金装纸尿裤，丝柔亲肤，3D悬浮芯体，12小时干爽',
    brand: '好奇', categoryId: getCatId('diapers'),
    minPrice: '139.00', maxPrice: '249.00', totalSales: randInt(2000, 5000),
    imageUrls: [placeholderImg('Huggies+L', 'BFDBFE', '5B21B6'), placeholderImg('Huggies+XL', 'DDD6FE', '7C3AED')],
    skuList: [
      { code: 'HGS-PLT-L-58', price: '139.00', comparePrice: '169.00', stock: 300, attributes: { size: 'L', spec: '58片' } },
      { code: 'HGS-PLT-L-116', price: '249.00', comparePrice: '319.00', stock: 200, attributes: { size: 'L', spec: '116片(2包)' } },
    ],
  });

  await insertProductIfNotExists({
    title: '帮宝适 一级帮 拉拉裤 XL42片', slug: 'pampers-premium-pants-xl42',
    description: '帮宝适一级帮拉拉裤，日本进口，10倍透气，纱布般柔软',
    brand: '帮宝适', categoryId: getCatId('diapers'),
    minPrice: '119.00', maxPrice: '219.00', totalSales: randInt(1500, 4000),
    imageUrls: [placeholderImg('Pampers+XL', 'FED7AA', 'C2410C'), placeholderImg('Premium', 'FDBA74', '9A3412')],
    skuList: [
      { code: 'PMP-1-XL-42', price: '119.00', comparePrice: '149.00', stock: 350, attributes: { size: 'XL', spec: '42片' } },
      { code: 'PMP-1-XL-84', price: '219.00', comparePrice: '279.00', stock: 200, attributes: { size: 'XL', spec: '84片(2包)' } },
    ],
  });

  // ── 母婴玩具 · 玩具 ──
  await insertProductIfNotExists({
    title: 'Fisher-Price 费雪 学步车 多功能', slug: 'fisher-price-learn-walker',
    description: 'Fisher-Price 学步车，坐玩站走四合一，早教音乐游戏面板',
    brand: 'Fisher-Price', categoryId: getCatId('toys'),
    minPrice: '269.00', maxPrice: '269.00', totalSales: randInt(1500, 3500),
    imageUrls: [placeholderImg('Fisher+Walker', '0EA5E9', 'F0F9FF'), placeholderImg('Learn+Walk', '0284C7', 'E0F2FE')],
    skuList: [
      { code: 'FP-WALKER-BLU', price: '269.00', comparePrice: '349.00', stock: 150, attributes: { color: '蓝色', ageRange: '6-36个月' } },
      { code: 'FP-WALKER-PNK', price: '269.00', comparePrice: '349.00', stock: 120, attributes: { color: '粉色', ageRange: '6-36个月' } },
    ],
  });

  // ══════════════════════════════════════════════════════════════
  // 批量补充商品 — 每分类补至 20+
  // ══════════════════════════════════════════════════════════════
  console.log('Bulk inserting catalog products...');
  for (const cat of bulkCatalog) {
    for (const p of cat.products) {
      const maxP = p.mp ?? p.p;
      const baseCode = p.s.replace(/-/g, '_').toUpperCase().substring(0, 22);
      const skuList = p.p === maxP
        ? [{ code: `${baseCode}_S`, price: p.p.toFixed(2), comparePrice: Math.round(p.p * 1.15).toFixed(2), stock: randInt(50, 400), attributes: { spec: '标准' } }]
        : [
            { code: `${baseCode}_V1`, price: p.p.toFixed(2), comparePrice: Math.round(p.p * 1.12).toFixed(2), stock: randInt(80, 350), attributes: { spec: '标准版' } },
            { code: `${baseCode}_V2`, price: maxP.toFixed(2), comparePrice: Math.round(maxP * 1.1).toFixed(2), stock: randInt(40, 200), attributes: { spec: '升级版' } },
          ];
      await insertProductIfNotExists({
        title: p.t, slug: p.s, description: p.d, brand: p.b,
        categoryId: getCatId(cat.catSlug),
        minPrice: p.p.toFixed(2), maxPrice: maxP.toFixed(2),
        totalSales: randInt(100, 5000),
        imageUrls: [
          placeholderImg(p.b.substring(0, 10), cat.bg, 'FFF'),
          placeholderImg(p.t.substring(0, 12), cat.bg, 'FFF'),
        ],
        skuList,
      });
    }
  }
  console.log('  Bulk catalog done.\n');

  console.log('  Products done.\n');

  // ══════════════════════════════════════════════════════════════
  // Banners（首页轮播图）
  // ══════════════════════════════════════════════════════════════
  console.log('Upserting banners...');
  const bannerData = [
    { title: 'Spring Digital Sale', subtitle: '数码春季大促 全场低至5折', imageUrl: cdnImg('smartphones/iphone-13-pro/1.webp'), linkType: 'category' as const, linkValue: 'digital', sortOrder: 1 },
    { title: 'iPhone 15 Pro Max', subtitle: '钛金属设计 Pro级芯片', imageUrl: cdnImg('smartphones/iphone-13-pro/2.webp'), linkType: 'product' as const, linkValue: 'iphone-15-pro-max', sortOrder: 2 },
    { title: 'Fashion Week', subtitle: '时尚穿搭精选 新品上市', imageUrl: cdnImg('womens-dresses/dress-pea/1.webp'), linkType: 'category' as const, linkValue: 'clothing', sortOrder: 3 },
    { title: 'Dyson V15 Detect', subtitle: '激光探测灰尘 深度清洁', imageUrl: placeholderImg('Dyson+V15+Detect', 'F59E0B', 'FFF'), linkType: 'product' as const, linkValue: 'dyson-v15-detect', sortOrder: 4 },
    { title: 'Best Sellers Books', subtitle: '年度畅销书单 买3免1', imageUrl: placeholderImg('Best+Sellers', '7C3AED', 'F5F3FF'), linkType: 'category' as const, linkValue: 'books', sortOrder: 5 },
    { title: 'Fresh Fruits', subtitle: '进口生鲜直达 新鲜到家', imageUrl: cdnImg('groceries/strawberry/1.webp'), linkType: 'category' as const, linkValue: 'fresh', sortOrder: 6 },
  ];
  for (const b of bannerData) {
    // 用 title 判断是否已存在
    const existing = await db.execute(
      sql`SELECT id, data_source FROM product_service.banners WHERE title = ${b.title} LIMIT 1`
    );
    if ((existing as any[]).length > 0) {
      const row = (existing as any[])[0];
      if (row.data_source !== 'seed') {
        console.log(`  [skip] banner "${b.title}" (managed by ${row.data_source})`);
      } else {
        // 更新 seed 管理的 banner
        await db.execute(sql`
          UPDATE product_service.banners
          SET subtitle = ${b.subtitle}, image_url = ${b.imageUrl}, link_type = ${b.linkType},
              link_value = ${b.linkValue}, sort_order = ${b.sortOrder}, updated_at = NOW()
          WHERE id = ${row.id} AND data_source = 'seed'
        `);
        console.log(`  [update] banner "${b.title}"`);
      }
    } else {
      await db.insert(banners).values({
        id: generateId(),
        title: b.title,
        subtitle: b.subtitle,
        imageUrl: b.imageUrl,
        dataSource: 'seed',
        linkType: b.linkType,
        linkValue: b.linkValue,
        sortOrder: b.sortOrder,
        isActive: true,
      });
      console.log(`  [new] banner "${b.title}"`);
    }
  }
  console.log('  Banners done.\n');

  // ── Redis 库存同步（仅新增的 SKU）──
  if (allSkuData.length > 0) {
    console.log('Syncing Redis stock for new SKUs...');
    let synced = 0;
    for (const sku of allSkuData) {
      // 只设置 Redis 中不存在的 key（SETNX 语义）
      const existing = await getStock(redis, sku.id);
      if (existing === 0) {
        await setStock(redis, sku.id, sku.stock);
        synced++;
      }
    }
    console.log(`  ${synced} new SKU stock keys set (${allSkuData.length - synced} already existed)\n`);
  }

  // ── 统计 ──
  console.log('=== Production Seed Summary ===');
  console.log('  Categories: 40 (10 top-level + 30 sub)');
  console.log('  Products:   91 + ~500 bulk (skipped if already exist)');
  console.log('  Banners:    6 (skipped if any exist)');
  console.log(`  New SKUs:   ${allSkuData.length}`);
  console.log('===============================\n');
}

// ── 执行入口 ──
seedProd()
  .then(() => {
    console.log('Production seed completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Production seed failed:', err);
    process.exit(1);
  });
