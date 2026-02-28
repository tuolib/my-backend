import {
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { baseColumns } from './_common';
import { orders } from './orders';

export const paymentMethodEnum = pgEnum('payment_method', [
  'alipay',
  'wechat',
  'credit_card',
  'balance',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'success',
  'failed',
  'refunded',
]);

export const payments = pgTable(
  'payments',
  {
    ...baseColumns(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    paymentNo: varchar('payment_no', { length: 64 }).notNull().unique(),
    method: paymentMethodEnum('method').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    status: paymentStatusEnum('status').notNull().default('pending'),
    providerTransactionId: varchar('provider_transaction_id', { length: 255 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    rawResponse: jsonb('raw_response'),
  },
  (t) => [
    index('idx_payments_order_id').on(t.orderId),
    index('idx_payments_payment_no').on(t.paymentNo),
    index('idx_payments_status').on(t.status),
  ],
);

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, {
    fields: [payments.orderId],
    references: [orders.id],
  }),
}));

export const insertPaymentSchema = createInsertSchema(payments);
export const selectPaymentSchema = createSelectSchema(payments);
