/**
 * Product Service 域 — PG Schema: product_service
 * 表: categories, products, product_categories, product_images, skus, banners
 */
import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { baseColumns, optimisticLock, softDelete } from './_common';

// ── PG Schema ──
export const productServiceSchema = pgSchema('product_service');

// ── categories 表 ──
export const categories = productServiceSchema.table(
  'categories',
  {
    ...baseColumns(),
    parentId: varchar('parent_id', { length: 21 }),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    iconUrl: text('icon_url'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    index('idx_categories_parent').on(t.parentId),
    index('idx_categories_slug').on(t.slug),
  ],
);

// ── products 表 ──
export const products = productServiceSchema.table(
  'products',
  {
    ...baseColumns(),
    ...softDelete(),
    title: varchar('title', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 200 }).notNull().unique(),
    description: text('description'),
    brand: varchar('brand', { length: 100 }),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    attributes: jsonb('attributes'),
    minPrice: decimal('min_price', { precision: 12, scale: 2 }),
    maxPrice: decimal('max_price', { precision: 12, scale: 2 }),
    totalSales: integer('total_sales').notNull().default(0),
    avgRating: decimal('avg_rating', { precision: 2, scale: 1 }).notNull().default('0'),
    reviewCount: integer('review_count').notNull().default(0),
  },
  (t) => [
    index('idx_products_status').on(t.status),
    index('idx_products_slug').on(t.slug),
    index('idx_products_brand').on(t.brand),
  ],
);

// ── product_categories 表（多对多关联）──
export const productCategories = productServiceSchema.table(
  'product_categories',
  {
    productId: varchar('product_id', { length: 21 }).notNull().references(() => products.id),
    categoryId: varchar('category_id', { length: 21 }).notNull().references(() => categories.id),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.categoryId] }),
  ],
);

// ── product_images 表 ──
export const productImages = productServiceSchema.table(
  'product_images',
  {
    id: varchar('id', { length: 21 }).primaryKey(),
    productId: varchar('product_id', { length: 21 }).notNull().references(() => products.id),
    url: text('url').notNull(),
    altText: varchar('alt_text', { length: 200 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_product_images_product').on(t.productId),
  ],
);

// ── skus 表 ──
export const skus = productServiceSchema.table(
  'skus',
  {
    ...baseColumns(),
    productId: varchar('product_id', { length: 21 }).notNull().references(() => products.id),
    skuCode: varchar('sku_code', { length: 50 }).notNull().unique(),
    price: decimal('price', { precision: 12, scale: 2 }).notNull(),
    comparePrice: decimal('compare_price', { precision: 12, scale: 2 }),
    costPrice: decimal('cost_price', { precision: 12, scale: 2 }),
    stock: integer('stock').notNull().default(0),
    lowStock: integer('low_stock').notNull().default(5),
    weight: decimal('weight', { precision: 8, scale: 2 }),
    attributes: jsonb('attributes').$type<Record<string, string>>(),
    barcode: varchar('barcode', { length: 50 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    ...optimisticLock(),
  },
  (t) => [
    index('idx_skus_product').on(t.productId),
    index('idx_skus_code').on(t.skuCode),
  ],
);

// ── Relations ──
export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_parent',
  }),
  children: many(categories, { relationName: 'category_parent' }),
  productCategories: many(productCategories),
}));

export const productsRelations = relations(products, ({ many }) => ({
  productCategories: many(productCategories),
  images: many(productImages),
  skus: many(skus),
}));

export const productCategoriesRelations = relations(productCategories, ({ one }) => ({
  product: one(products, {
    fields: [productCategories.productId],
    references: [products.id],
  }),
  category: one(categories, {
    fields: [productCategories.categoryId],
    references: [categories.id],
  }),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

export const skusRelations = relations(skus, ({ one }) => ({
  product: one(products, {
    fields: [skus.productId],
    references: [products.id],
  }),
}));

// ── banners 表（首页轮播图）──
export const banners = productServiceSchema.table(
  'banners',
  {
    ...baseColumns(),
    title: varchar('title', { length: 200 }).notNull(),
    subtitle: varchar('subtitle', { length: 200 }),
    imageUrl: text('image_url').notNull(),
    linkType: varchar('link_type', { length: 20 }).notNull().default('product'),
    linkValue: varchar('link_value', { length: 200 }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }),
    endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('idx_banners_active_sort').on(t.isActive, t.sortOrder),
  ],
);

// ── Types ──
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductImage = typeof productImages.$inferSelect;
export type NewProductImage = typeof productImages.$inferInsert;
export type Sku = typeof skus.$inferSelect;
export type NewSku = typeof skus.$inferInsert;
export type Banner = typeof banners.$inferSelect;
export type NewBanner = typeof banners.$inferInsert;
