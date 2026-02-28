import { index, pgEnum, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { baseColumns, optimisticLock, softDelete } from './_common';
import { categories } from './categories';
import { skus } from './skus';

export const productStatusEnum = pgEnum('product_status', ['draft', 'active', 'inactive']);

export const products = pgTable(
  'products',
  {
    ...baseColumns(),
    ...softDelete(),
    ...optimisticLock(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    description: text('description'),
    brand: varchar('brand', { length: 100 }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    status: productStatusEnum('status').notNull().default('draft'),
  },
  (t) => [
    index('idx_products_slug').on(t.slug),
    index('idx_products_category_id').on(t.categoryId),
    index('idx_products_status').on(t.status),
  ],
);

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  skus: many(skus),
}));

export const insertProductSchema = createInsertSchema(products);
export const selectProductSchema = createSelectSchema(products);
