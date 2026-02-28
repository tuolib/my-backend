import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { baseColumns } from './_common';
import { orders } from './orders';
import { skus } from './skus';

export const orderItems = pgTable(
  'order_items',
  {
    ...baseColumns(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    productSnapshot: jsonb('product_snapshot').notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    quantity: integer('quantity').notNull(),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    index('idx_order_items_order_id').on(t.orderId),
    index('idx_order_items_sku_id').on(t.skuId),
    check('chk_order_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  sku: one(skus, {
    fields: [orderItems.skuId],
    references: [skus.id],
  }),
}));

export const insertOrderItemSchema = createInsertSchema(orderItems);
export const selectOrderItemSchema = createSelectSchema(orderItems);
