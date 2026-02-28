import { index, integer, pgEnum, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { baseColumns } from './_common';
import { skus } from './skus';

export const inventoryLogTypeEnum = pgEnum('inventory_log_type', [
  'purchase_in',
  'sale_out',
  'return_in',
  'adjust',
  'lock',
  'unlock',
]);

export const inventoryLogs = pgTable(
  'inventory_logs',
  {
    ...baseColumns(),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),
    changeQuantity: integer('change_quantity').notNull(),
    type: inventoryLogTypeEnum('type').notNull(),
    referenceType: varchar('reference_type', { length: 50 }).notNull(),
    referenceId: uuid('reference_id').notNull(),
    beforeStock: integer('before_stock').notNull(),
    afterStock: integer('after_stock').notNull(),
    operatorId: uuid('operator_id'),
  },
  (t) => [
    index('idx_inventory_logs_sku_id').on(t.skuId),
    index('idx_inventory_logs_type').on(t.type),
    index('idx_inventory_logs_created_at').on(t.createdAt.desc()),
    index('idx_inventory_logs_reference').on(t.referenceType, t.referenceId),
  ],
);

export const inventoryLogsRelations = relations(inventoryLogs, ({ one }) => ({
  sku: one(skus, {
    fields: [inventoryLogs.skuId],
    references: [skus.id],
  }),
}));

export const insertInventoryLogSchema = createInsertSchema(inventoryLogs);
export const selectInventoryLogSchema = createSelectSchema(inventoryLogs);
