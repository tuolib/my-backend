/**
 * Order Service 域 — PG Schema: order_service
 * 表: orders, order_items, order_addresses, payment_records, stock_operations
 */
import {
  decimal,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { baseColumns, optimisticLock } from './_common';

// ── PG Schema ──
export const orderServiceSchema = pgSchema('order_service');

// ── orders 表 ──
export const orders = orderServiceSchema.table(
  'orders',
  {
    ...baseColumns(),
    orderNo: varchar('order_no', { length: 32 }).notNull().unique(),
    userId: varchar('user_id', { length: 21 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
    discountAmount: decimal('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    payAmount: decimal('pay_amount', { precision: 12, scale: 2 }).notNull(),
    paymentMethod: varchar('payment_method', { length: 20 }),
    paymentNo: varchar('payment_no', { length: 100 }),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
    shippedAt: timestamp('shipped_at', { withTimezone: true, mode: 'date' }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelReason: text('cancel_reason'),
    remark: text('remark'),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...optimisticLock(),
  },
  (t) => [
    index('idx_orders_user').on(t.userId),
    index('idx_orders_user_status').on(t.userId, t.status),
    index('idx_orders_status').on(t.status),
    index('idx_orders_no').on(t.orderNo),
    index('idx_orders_idempotency').on(t.idempotencyKey),
  ],
);

// ── order_items 表 ──
export const orderItems = orderServiceSchema.table(
  'order_items',
  {
    id: varchar('id', { length: 21 }).primaryKey(),
    orderId: varchar('order_id', { length: 21 }).notNull().references(() => orders.id),
    productId: varchar('product_id', { length: 21 }).notNull(),
    skuId: varchar('sku_id', { length: 21 }).notNull(),
    productTitle: varchar('product_title', { length: 200 }).notNull(),
    skuAttrs: jsonb('sku_attrs').notNull(),
    imageUrl: text('image_url'),
    unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
    quantity: integer('quantity').notNull(),
    subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_order_items_order').on(t.orderId),
    index('idx_order_items_sku').on(t.skuId),
  ],
);

// ── order_addresses 表（地址快照，不 FK 到 user_addresses）──
export const orderAddresses = orderServiceSchema.table(
  'order_addresses',
  {
    id: varchar('id', { length: 21 }).primaryKey(),
    orderId: varchar('order_id', { length: 21 }).notNull().unique().references(() => orders.id),
    recipient: varchar('recipient', { length: 100 }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    province: varchar('province', { length: 50 }).notNull(),
    city: varchar('city', { length: 50 }).notNull(),
    district: varchar('district', { length: 50 }).notNull(),
    address: text('address').notNull(),
    postalCode: varchar('postal_code', { length: 10 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_order_addresses_order').on(t.orderId),
  ],
);

// ── payment_records 表 ──
export const paymentRecords = orderServiceSchema.table(
  'payment_records',
  {
    ...baseColumns(),
    orderId: varchar('order_id', { length: 21 }).notNull().references(() => orders.id),
    paymentMethod: varchar('payment_method', { length: 20 }).notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    transactionId: varchar('transaction_id', { length: 100 }),
    rawNotify: jsonb('raw_notify'),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).unique(),
  },
  (t) => [
    index('idx_payment_records_order').on(t.orderId),
  ],
);

// ── stock_operations 表（库存操作日志）──
export const stockOperations = orderServiceSchema.table(
  'stock_operations',
  {
    id: varchar('id', { length: 21 }).primaryKey(),
    skuId: varchar('sku_id', { length: 21 }).notNull(),
    orderId: varchar('order_id', { length: 21 }),
    type: varchar('type', { length: 20 }).notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_stock_ops_sku').on(t.skuId),
    index('idx_stock_ops_order').on(t.orderId),
  ],
);

// ── Relations ──
export const ordersRelations = relations(orders, ({ one, many }) => ({
  orderItems: many(orderItems),
  orderAddress: one(orderAddresses),
  paymentRecords: many(paymentRecords),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
}));

export const orderAddressesRelations = relations(orderAddresses, ({ one }) => ({
  order: one(orders, {
    fields: [orderAddresses.orderId],
    references: [orders.id],
  }),
}));

export const paymentRecordsRelations = relations(paymentRecords, ({ one }) => ({
  order: one(orders, {
    fields: [paymentRecords.orderId],
    references: [orders.id],
  }),
}));

// ── Types ──
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type OrderAddress = typeof orderAddresses.$inferSelect;
export type NewOrderAddress = typeof orderAddresses.$inferInsert;
export type PaymentRecord = typeof paymentRecords.$inferSelect;
export type NewPaymentRecord = typeof paymentRecords.$inferInsert;
export type StockOperation = typeof stockOperations.$inferSelect;
export type NewStockOperation = typeof stockOperations.$inferInsert;
