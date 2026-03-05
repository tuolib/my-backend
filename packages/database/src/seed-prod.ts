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
} from './schema';

// ── 辅助：生成 placehold.co URL ──
function placeholderImg(text: string, bg = 'EEE', fg = '999'): string {
  return `https://placehold.co/800x800/${bg}/${fg}?text=${encodeURIComponent(text)}`;
}

// ── 辅助：随机整数 ──
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
  imgBg: string;
  imgFg?: string;
  imgTexts: string[];
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
    sql`SELECT id FROM product_service.products WHERE slug = ${opts.slug} LIMIT 1`
  );
  if (existing.length > 0) {
    console.log(`  [skip] "${opts.title}" already exists`);
    return;
  }

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
  });

  const fg = opts.imgFg || 'FFF';
  await db.insert(productImages).values(
    opts.imgTexts.map((text, i) => ({
      id: generateId(),
      productId: prodId,
      url: placeholderImg(text, opts.imgBg, fg),
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
    imgBg: '3B82F6', imgTexts: ['iPhone15PM-1', 'iPhone15PM-2', 'iPhone15PM-3'],
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
    imgBg: '1E40AF', imgTexts: ['Mate60Pro-1', 'Mate60Pro-2'],
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
    imgBg: '2563EB', imgTexts: ['Mi14Ultra-1', 'Mi14Ultra-2'],
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
    imgBg: '1D4ED8', imgTexts: ['S24Ultra-1', 'S24Ultra-2', 'S24Ultra-3'],
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
    imgBg: '60A5FA', imgTexts: ['AirPodsPro2-1', 'AirPodsPro2-2'],
    skuList: [
      { code: 'APP2-USBC', price: '1799.00', comparePrice: '1999.00', stock: 500, attributes: { version: 'USB-C', color: '白色' } },
    ],
  });

  await insertProductIfNotExists({
    title: '索尼 WH-1000XM5 头戴式降噪耳机', slug: 'sony-wh1000xm5',
    description: '索尼旗舰降噪耳机，30小时续航，高解析度音频，佩戴舒适',
    brand: 'Sony', categoryId: getCatId('earphones'),
    minPrice: '2299.00', maxPrice: '2299.00', totalSales: randInt(1000, 3000),
    imgBg: '3B82F6', imgTexts: ['SonyXM5-1', 'SonyXM5-2'],
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
    imgBg: '2563EB', imgTexts: ['AWUltra2-1', 'AWUltra2-2'],
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
    imgBg: '6366F1', imgTexts: ['MBP14-1', 'MBP14-2', 'MBP14-3'],
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
    imgBg: '818CF8', imgTexts: ['X1Carbon-1', 'X1Carbon-2'],
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
    imgBg: '6366F1', imgTexts: ['iPadAirM2-1', 'iPadAirM2-2'],
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
    imgBg: '818CF8', imgTexts: ['MatePadPro-1', 'MatePadPro-2'],
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
    imgBg: '6366F1', imgTexts: ['HHKB-1', 'HHKB-2'],
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
    imgBg: 'F59E0B', imgTexts: ['DysonV15-1', 'DysonV15-2', 'DysonV15-3'],
    skuList: [
      { code: 'V15-DETECT-GLD', price: '4590.00', comparePrice: '5490.00', stock: 100, attributes: { color: '金色', version: '旗舰版' } },
    ],
  });

  await insertProductIfNotExists({
    title: '戴森 Supersonic 吹风机 HD15', slug: 'dyson-supersonic-hd15',
    description: '戴森吹风机 HD15，智能温控，防飞翘风嘴，5款造型风嘴',
    brand: 'Dyson', categoryId: getCatId('small-appliance'),
    minPrice: '3199.00', maxPrice: '3199.00', totalSales: randInt(2000, 5000),
    imgBg: 'D97706', imgTexts: ['DysonHD15-1', 'DysonHD15-2'],
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
    imgBg: 'D97706', imgTexts: ['HaierFridge-1', 'HaierFridge-2'],
    skuList: [
      { code: 'HAIER-510-GLD', price: '3299.00', comparePrice: '3999.00', stock: 50, lowStock: 10, attributes: { color: '金色', capacity: '510L' } },
    ],
  });

  await insertProductIfNotExists({
    title: '美的电饭煲 MB-FB40Simple', slug: 'midea-rice-cooker-fb40',
    description: '美的智能电饭煲，4L大容量，24小时预约，多功能菜单',
    brand: '美的', categoryId: getCatId('kitchen-appliance'),
    minPrice: '299.00', maxPrice: '299.00', totalSales: randInt(2000, 5000),
    imgBg: 'F59E0B', imgTexts: ['MideaRice-1', 'MideaRice-2'],
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
    imgBg: 'EC4899', imgTexts: ['NikeTee-1', 'NikeTee-2'],
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
    imgBg: 'DB2777', imgTexts: ['Levis501-1', 'Levis501-2'],
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
    imgBg: 'EC4899', imgTexts: ['UniqloDown-1', 'UniqloDown-2'],
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
    imgBg: 'EC4899', imgTexts: ['FloralDress-1', 'FloralDress-2', 'FloralDress-3'],
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
    imgBg: 'F472B6', imgTexts: ['UBLight-1', 'UBLight-2', 'UBLight-3'],
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
    imgBg: '22C55E', imgTexts: ['DailyNuts-1', 'DailyNuts-2'],
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
    imgBg: '16A34A', imgTexts: ['NongfuWater-1', 'NongfuWater-2'],
    skuList: [
      { code: 'NFS-550-24', price: '29.90', comparePrice: '39.90', stock: 500, attributes: { spec: '550ml×24瓶' } },
    ],
  });

  await insertProductIfNotExists({
    title: '精品咖啡豆 哥伦比亚单一产区', slug: 'premium-coffee-colombia',
    description: '哥伦比亚单一产区精品咖啡豆，中深烘焙，坚果巧克力风味',
    brand: 'BeanMaster', categoryId: getCatId('drinks'),
    minPrice: '68.00', maxPrice: '128.00', totalSales: randInt(800, 2500),
    imgBg: '22C55E', imgTexts: ['Coffee-1', 'Coffee-2'],
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
    imgBg: '15803D', imgTexts: ['Cherry-1', 'Cherry-2'],
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
    imgBg: 'F472B6', imgTexts: ['SKII-1', 'SKII-2'],
    skuList: [
      { code: 'SKII-FTE-230', price: '1370.00', comparePrice: '1590.00', stock: 200, attributes: { spec: '230ml' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'MAC 魅可 子弹头口红', slug: 'mac-lipstick-bullet',
    description: 'MAC 经典子弹头口红，高饱和色彩，丝缎质地，持久不脱色',
    brand: 'MAC', categoryId: getCatId('makeup'),
    minPrice: '230.00', maxPrice: '230.00', totalSales: randInt(2500, 5000),
    imgBg: 'EC4899', imgTexts: ['MACLip-1', 'MACLip-2'],
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
    imgBg: 'F9A8D4', imgTexts: ['LorealShampoo-1', 'LorealShampoo-2'],
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
    imgBg: '8B5CF6', imgTexts: ['SanTi-1', 'SanTi-2'],
    skuList: [
      { code: 'SANTI-3BOOK', price: '93.00', comparePrice: '168.00', stock: 500, attributes: { version: '典藏版', format: '纸质书' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'JavaScript高级程序设计 第4版', slug: 'professional-javascript-4th',
    description: '红宝书，前端开发必读经典，全面覆盖ES6+特性',
    brand: '人民邮电出版社', categoryId: getCatId('education'),
    minPrice: '99.00', maxPrice: '99.00', totalSales: randInt(1500, 3000),
    imgBg: 'A78BFA', imgTexts: ['JSBook-1', 'JSBook-2'],
    skuList: [
      { code: 'PROJS-4TH', price: '99.00', comparePrice: '129.00', stock: 300, attributes: { version: '第4版', format: '纸质书' } },
    ],
  });

  await insertProductIfNotExists({
    title: '海贼王 航海王漫画 1-106卷', slug: 'one-piece-manga-1-106',
    description: '尾田荣一郎经典漫画，全球累计发行超5亿册',
    brand: '浙江人民美术出版社', categoryId: getCatId('comic'),
    minPrice: '5.90', maxPrice: '1999.00', totalSales: randInt(2000, 5000),
    imgBg: '7C3AED', imgTexts: ['OnePiece-1', 'OnePiece-2'],
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
    imgBg: '14B8A6', imgTexts: ['KeepBike-1', 'KeepBike-2', 'KeepBike-3'],
    skuList: [
      { code: 'KEEP-C1-WHT', price: '1999.00', comparePrice: '2499.00', stock: 80, attributes: { color: '白色' } },
    ],
  });

  await insertProductIfNotExists({
    title: '北面 The North Face 冲锋衣 男款', slug: 'tnf-gore-tex-jacket-men',
    description: 'The North Face GORE-TEX 冲锋衣，防水防风透气，户外徒步必备',
    brand: 'The North Face', categoryId: getCatId('outdoor'),
    minPrice: '1999.00', maxPrice: '1999.00', totalSales: randInt(800, 2500),
    imgBg: '0D9488', imgTexts: ['TNFJacket-1', 'TNFJacket-2'],
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
    imgBg: '14B8A6', imgTexts: ['Pegasus40-1', 'Pegasus40-2'],
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
    imgBg: 'F97316', imgTexts: ['WoodDesk-1', 'WoodDesk-2', 'WoodDesk-3'],
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
    imgBg: 'EA580C', imgTexts: ['Fuanna-1', 'Fuanna-2'],
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
    imgBg: 'FB923C', imgTexts: ['Tenma-1', 'Tenma-2'],
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
    imgBg: 'FB923C', imgTexts: ['Firmus-1', 'Firmus-2'],
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
    imgBg: 'F59E0B', imgTexts: ['Merries-1', 'Merries-2'],
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
    imgBg: 'FBBF24', imgTexts: ['LEGO42151-1', 'LEGO42151-2', 'LEGO42151-3'],
    skuList: [
      { code: 'LEGO-42151', price: '349.00', comparePrice: '449.00', stock: 150, lowStock: 10, attributes: { pieces: '905', age: '9+' } },
    ],
  });

  await insertProductIfNotExists({
    title: 'B.Duck 小黄鸭 儿童滑板车', slug: 'bduck-kids-scooter',
    description: 'B.Duck 小黄鸭儿童三轮滑板车，可折叠，可调节高度，闪光轮',
    brand: 'B.Duck', categoryId: getCatId('toys'),
    minPrice: '199.00', maxPrice: '199.00', totalSales: randInt(1000, 3000),
    imgBg: 'FBBF24', imgTexts: ['BDuck-1', 'BDuck-2'],
    skuList: [
      { code: 'BDUCK-SCOOT-YLW', price: '199.00', comparePrice: '269.00', stock: 200, attributes: { color: '黄色', ageRange: '3-8岁' } },
      { code: 'BDUCK-SCOOT-PNK', price: '199.00', comparePrice: '269.00', stock: 150, attributes: { color: '粉色', ageRange: '3-8岁' } },
    ],
  });

  console.log('  Products done.\n');

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
  console.log('  Products:   42 (skipped if already exist)');
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
