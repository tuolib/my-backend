/**
 * 数据迁移: 将商品图片从 placehold.co 占位图更新为 dummyjson CDN 真实产品图
 * 只更新 data_source='seed' 的商品（Admin 修改过的不碰）
 */
import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { DataMigrationDef } from '../data-migrate';

const CDN = 'https://cdn.dummyjson.com/product-images';

// slug → 新图片 URL 映射
const imageMap: Record<string, string[]> = {
  'iphone-15-pro-max': [
    `${CDN}/smartphones/iphone-13-pro/1.webp`,
    `${CDN}/smartphones/iphone-13-pro/2.webp`,
    `${CDN}/smartphones/iphone-13-pro/3.webp`,
  ],
  'huawei-mate60-pro': [
    `${CDN}/smartphones/samsung-galaxy-s8/1.webp`,
    `${CDN}/smartphones/samsung-galaxy-s8/2.webp`,
  ],
  'xiaomi-14-ultra': [
    `${CDN}/smartphones/oppo-f19-pro-plus/1.webp`,
    `${CDN}/smartphones/realme-xt/1.webp`,
  ],
  'samsung-galaxy-s24-ultra': [
    `${CDN}/smartphones/samsung-galaxy-s10/1.webp`,
    `${CDN}/smartphones/samsung-galaxy-s10/2.webp`,
    `${CDN}/smartphones/samsung-galaxy-s10/3.webp`,
  ],
  'airpods-pro-2': [
    `${CDN}/mobile-accessories/apple-airpods/1.webp`,
    `${CDN}/mobile-accessories/apple-airpods/2.webp`,
  ],
  'sony-wh1000xm5': [
    `${CDN}/mobile-accessories/apple-airpods-max-silver/1.webp`,
    `${CDN}/mobile-accessories/beats-flex-wireless-earphones/1.webp`,
  ],
  'apple-watch-ultra-2': [
    `${CDN}/mobile-accessories/apple-watch-series-4-gold/1.webp`,
    `${CDN}/mobile-accessories/apple-watch-series-4-gold/2.webp`,
  ],
  'macbook-pro-14-m3pro': [
    `${CDN}/laptops/apple-macbook-pro-14-inch-space-grey/1.webp`,
    `${CDN}/laptops/apple-macbook-pro-14-inch-space-grey/2.webp`,
    `${CDN}/laptops/apple-macbook-pro-14-inch-space-grey/3.webp`,
  ],
  'thinkpad-x1-carbon-11': [
    `${CDN}/laptops/lenovo-yoga-920/1.webp`,
    `${CDN}/laptops/lenovo-yoga-920/2.webp`,
  ],
  'ipad-air-m2': [
    `${CDN}/tablets/ipad-mini-2021-starlight/1.webp`,
    `${CDN}/tablets/ipad-mini-2021-starlight/2.webp`,
  ],
  'huawei-matepad-pro-13': [
    `${CDN}/tablets/samsung-galaxy-tab-s8-plus-grey/1.webp`,
    `${CDN}/tablets/samsung-galaxy-tab-s8-plus-grey/2.webp`,
  ],
  'nike-drifit-tshirt-men': [
    `${CDN}/mens-shirts/man-short-sleeve-shirt/1.webp`,
    `${CDN}/mens-shirts/man-short-sleeve-shirt/2.webp`,
  ],
  'levis-501-original-men': [
    `${CDN}/mens-shirts/blue-&-black-check-shirt/1.webp`,
    `${CDN}/mens-shirts/blue-&-black-check-shirt/2.webp`,
  ],
  'uniqlo-ultra-light-down-women': [
    `${CDN}/tops/gray-dress/1.webp`,
    `${CDN}/tops/gray-dress/2.webp`,
  ],
  'floral-dress-french-vintage': [
    `${CDN}/womens-dresses/dress-pea/1.webp`,
    `${CDN}/womens-dresses/dress-pea/2.webp`,
    `${CDN}/womens-dresses/dress-pea/3.webp`,
  ],
  'adidas-ultraboost-light': [
    `${CDN}/mens-shoes/sports-sneakers-off-white-&-red/1.webp`,
    `${CDN}/mens-shoes/sports-sneakers-off-white-&-red/2.webp`,
    `${CDN}/mens-shoes/sports-sneakers-off-white-&-red/3.webp`,
  ],
  'three-squirrels-daily-nuts': [
    `${CDN}/groceries/mulberry/1.webp`,
    `${CDN}/groceries/honey-jar/1.webp`,
  ],
  'nongfu-spring-water-24': [
    `${CDN}/groceries/water/1.webp`,
    `${CDN}/groceries/juice/1.webp`,
  ],
  'premium-coffee-colombia': [
    `${CDN}/groceries/nescafe-coffee/1.webp`,
    `${CDN}/groceries/ice-cream/1.webp`,
  ],
  'chile-cherry-jj-2lb': [
    `${CDN}/groceries/strawberry/1.webp`,
    `${CDN}/groceries/kiwi/1.webp`,
  ],
  'skii-facial-treatment-essence': [
    `${CDN}/skin-care/olay-ultra-moisture-shea-butter-body-wash/1.webp`,
    `${CDN}/skin-care/olay-ultra-moisture-shea-butter-body-wash/2.webp`,
  ],
  'mac-lipstick-bullet': [
    `${CDN}/beauty/red-lipstick/1.webp`,
    `${CDN}/beauty/eyeshadow-palette-with-mirror/1.webp`,
  ],
  'loreal-hyaluronic-shampoo': [
    `${CDN}/skin-care/vaseline-men-body-and-face-lotion/1.webp`,
    `${CDN}/skin-care/attitude-super-leaves-hand-soap/1.webp`,
  ],
  'nike-pegasus-40': [
    `${CDN}/mens-shoes/nike-air-jordan-1-red-and-black/1.webp`,
    `${CDN}/mens-shoes/nike-air-jordan-1-red-and-black/2.webp`,
  ],
  'genji-solid-wood-desk-120': [
    `${CDN}/furniture/bedside-table-african-cherry/1.webp`,
    `${CDN}/furniture/bedside-table-african-cherry/2.webp`,
    `${CDN}/furniture/bedside-table-african-cherry/3.webp`,
  ],
  'fuanna-100s-cotton-bedding': [
    `${CDN}/furniture/annibale-colombo-bed/1.webp`,
    `${CDN}/furniture/annibale-colombo-bed/2.webp`,
  ],
  'tenma-storage-box-3pack': [
    `${CDN}/home-decoration/house-showpiece-plant/1.webp`,
    `${CDN}/home-decoration/plant-pot/1.webp`,
  ],
  'firmus-starship-stage3': [
    `${CDN}/groceries/milk/1.webp`,
    `${CDN}/groceries/protein-powder/1.webp`,
  ],
  'midea-rice-cooker-fb40': [
    `${CDN}/kitchen-accessories/electric-stove/1.webp`,
    `${CDN}/kitchen-accessories/silver-pot-with-glass-cap/1.webp`,
  ],
};

export const migration: DataMigrationDef = {
  id: '001-product-images-cdn',
  description: '将 seed 商品的占位图替换为 dummyjson CDN 真实产品图',

  async up() {
    for (const [slug, urls] of Object.entries(imageMap)) {
      // 只查 data_source='seed' 的商品
      const rows = await db.execute(
        sql`SELECT id FROM product_service.products WHERE slug = ${slug} AND data_source = 'seed' LIMIT 1`
      );
      if ((rows as any[]).length === 0) {
        console.log(`    skip ${slug} (not found or admin-managed)`);
        continue;
      }
      const productId = (rows as any[])[0].id;

      // 删除旧图片
      await db.execute(
        sql`DELETE FROM product_service.product_images WHERE product_id = ${productId}`
      );

      // 插入新图片
      for (let i = 0; i < urls.length; i++) {
        const imgId = crypto.randomUUID().replace(/-/g, '').slice(0, 21);
        await db.execute(sql`
          INSERT INTO product_service.product_images (id, product_id, url, alt_text, is_primary, sort_order, created_at)
          VALUES (${imgId}, ${productId}, ${urls[i]}, ${`${slug} ${i + 1}`}, ${i === 0}, ${i}, NOW())
        `);
      }
      console.log(`    updated ${slug}: ${urls.length} images`);
    }
  },
};

export default migration;
