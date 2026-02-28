import {
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { baseColumns, optimisticLock, softDelete } from './_common';
import { users } from './users';
import { orderItems } from './order_items';
import { payments } from './payments';

export const orderStatusEnum = pgEnum('order_status', [
  'pending_payment',
  'paid',
  'shipping',
  'delivered',
  'completed',
  'cancelled',
  'refunding',
  'refunded',
]);

export const orders = pgTable(
  'orders',
  {
    ...baseColumns(),
    ...softDelete(),
    ...optimisticLock(),
    orderNo: varchar('order_no', { length: 32 }).notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: orderStatusEnum('status').notNull().default('pending_payment'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    shippingFee: numeric('shipping_fee', { precision: 12, scale: 2 }).notNull().default('0'),
    payAmount: numeric('pay_amount', { precision: 12, scale: 2 }).notNull(),
    addressSnapshot: jsonb('address_snapshot').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
  },
  (t) => [
    index('idx_orders_order_no').on(t.orderNo),
    index('idx_orders_user_id').on(t.userId),
    index('idx_orders_status').on(t.status),
    index('idx_orders_created_at').on(t.createdAt.desc()),
  ],
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  orderItems: many(orderItems),
  payments: many(payments),
}));

export const insertOrderSchema = createInsertSchema(orders);
export const selectOrderSchema = createSelectSchema(orders);
