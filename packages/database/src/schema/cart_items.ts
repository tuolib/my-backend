import { check, index, integer, pgTable, unique, uuid } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { baseColumns } from './_common';
import { users } from './users';
import { skus } from './skus';

export const cartItems = pgTable(
  'cart_items',
  {
    ...baseColumns(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    unique('uq_cart_items_user_sku').on(t.userId, t.skuId),
    index('idx_cart_items_user_id').on(t.userId),
    check('chk_cart_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  user: one(users, {
    fields: [cartItems.userId],
    references: [users.id],
  }),
  sku: one(skus, {
    fields: [cartItems.skuId],
    references: [skus.id],
  }),
}));

export const insertCartItemSchema = createInsertSchema(cartItems);
export const selectCartItemSchema = createSelectSchema(cartItems);
