import { boolean, index, integer, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { baseColumns, softDelete } from './_common';

export const categories = pgTable(
  'categories',
  {
    ...baseColumns(),
    ...softDelete(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    parentId: uuid('parent_id'),
    /** materialized path，格式如 "root_id/parent_id/self_id"，用于高效层级查询 */
    path: text('path').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    index('idx_categories_slug').on(t.slug),
    index('idx_categories_parent_id').on(t.parentId),
    index('idx_categories_path').on(t.path),
  ],
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_parent',
  }),
  children: many(categories, { relationName: 'category_parent' }),
}));

export const insertCategorySchema = createInsertSchema(categories);
export const selectCategorySchema = createSelectSchema(categories);
