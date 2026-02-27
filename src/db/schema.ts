// src/db/schema.ts
import { pgTable, serial, text, timestamp, boolean, integer, numeric, bigserial, varchar, smallint, jsonb, bigint, date, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // 阶段三新增字段
  phone: varchar('phone', { length: 20 }),
  pwdHash: varchar('pwd_hash', { length: 128 }),
  nickname: varchar('nickname', { length: 50 }),
  status: smallint('status').default(1),
});

export const restaurants = pgTable('restaurants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  address: text('address').notNull(),
  phone: text('phone'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const menuItems = pgTable('menu_items', {
  id: serial('id').primaryKey(),
  restaurantId: integer('restaurant_id').notNull().references(() => restaurants.id),
  name: text('name').notNull(),
  description: text('description'),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  category: text('category'),
  isAvailable: boolean('is_available').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 订单状态：pending（待付款）→ paid（已付款）→ completed（已完成），或 cancelled（已取消）
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  restaurantId: integer('restaurant_id').notNull().references(() => restaurants.id),
  status: text('status').notNull().default('pending'),
  totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).notNull(),
  remark: text('remark'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 订单明细：冗余快照（name/unitPrice），防止菜品改价后历史订单数据失真
export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id),
  menuItemId: integer('menu_item_id').notNull().references(() => menuItems.id),
  name: text('name').notNull(),
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
  quantity: integer('quantity').notNull(),
  subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
});

// ========== 阶段三·核心基础表 ==========

export const products = pgTable('products', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  title: varchar('title', { length: 200 }).notNull(),
  categoryId: integer('category_id').notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  status: smallint('status').default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const skus = pgTable('skus', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  productId: bigint('product_id', { mode: 'number' }).references(() => products.id),
  attrs: jsonb('attrs'),
  price: numeric('price', { precision: 12, scale: 2 }),
  amount: numeric('amount', { precision: 12, scale: 2 }),
  stock: integer('stock').notNull().default(0),
  status: smallint('status').default(0),
  paidAt: timestamp('paid_at', { withTimezone: true }),
});

// payments 父表（已改造为 RANGE 分区 by paid_at，子分区: payments_YYYY_MM）
export const payments = pgTable('payments', {
  id: bigserial('id', { mode: 'number' }).notNull(),
  orderId: bigint('order_id', { mode: 'number' }).notNull(),
  channel: varchar('channel', { length: 20 }),
  amount: numeric('amount', { precision: 12, scale: 2 }),
  status: smallint('status').default(0),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
});

// ========== 阶段三·第二步：订单分表 + 归档分区 ==========

/**
 * 订单分表工厂：orders_00 ~ orders_63（user_id % 64 路由）
 * 用法：const shard05 = ordersShardTable(5);
 */
export function ordersShardTable(shardNo: number) {
  const name = `orders_${String(shardNo).padStart(2, '0')}`;
  return pgTable(name, {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    total: numeric('total', { precision: 12, scale: 2 }),
    status: smallint('status').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  });
}

// 冷数据归档主表（RANGE 分区 by created_at，子分区: orders_archive_YYYY_MM）
export const ordersArchive = pgTable('orders_archive', {
  id: bigint('id', { mode: 'number' }).notNull(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  total: numeric('total', { precision: 12, scale: 2 }),
  status: smallint('status').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// ========== 阶段三·第三步：库存流水 + 出站事件 + 归档任务 ==========

export const stockLedger = pgTable('stock_ledger', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  skuId: bigint('sku_id', { mode: 'number' }).notNull(),
  orderId: bigint('order_id', { mode: 'number' }),
  delta: integer('delta').notNull(),
  reason: varchar('reason', { length: 32 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const outboxEvents = pgTable('outbox_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  aggregateType: varchar('aggregate_type', { length: 32 }).notNull(),
  aggregateId: varchar('aggregate_id', { length: 64 }).notNull(),
  payload: jsonb('payload').notNull(),
  status: smallint('status').notNull().default(0),
  retryCount: integer('retry_count').notNull().default(0),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const archiveJobs = pgTable('archive_jobs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  jobDate: date('job_date').notNull(),
  targetTable: varchar('target_table', { length: 64 }).notNull(),
  status: smallint('status').notNull().default(0),
  processedRows: bigint('processed_rows', { mode: 'number' }).notNull().default(0),
  errorMsg: text('error_msg'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
