import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { baseColumns, optimisticLock, softDelete } from './_common';
import { products } from './products';
import { cartItems } from './cart_items';
import { inventoryLogs } from './inventory_logs';
import { orderItems } from './order_items';

export const skus = pgTable(
  'skus',
  {
    ...baseColumns(),
    ...softDelete(),
    ...optimisticLock(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    skuCode: varchar('sku_code', { length: 100 }).notNull().unique(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    originalPrice: numeric('original_price', { precision: 12, scale: 2 }),
    /** 规格属性，如 {"颜色":"红","尺码":"XL"} */
    attributes: jsonb('attributes').$type<Record<string, string>>().default({}),
    stock: integer('stock').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(10),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    index('idx_skus_product_id').on(t.productId),
    index('idx_skus_sku_code').on(t.skuCode),
    index('idx_skus_is_active').on(t.isActive),
    check('chk_skus_stock_non_negative', sql`${t.stock} >= 0`),
  ],
);

export const skusRelations = relations(skus, ({ one, many }) => ({
  product: one(products, {
    fields: [skus.productId],
    references: [products.id],
  }),
  cartItems: many(cartItems),
  orderItems: many(orderItems),
  inventoryLogs: many(inventoryLogs),
}));

export const insertSkuSchema = createInsertSchema(skus);
export const selectSkuSchema = createSelectSchema(skus);
