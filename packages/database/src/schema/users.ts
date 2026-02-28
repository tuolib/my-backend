import { index, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { baseColumns, softDelete } from './_common';
import { orders } from './orders';
import { cartItems } from './cart_items';

export const userStatusEnum = pgEnum('user_status', ['active', 'inactive', 'banned']);

export const users = pgTable(
  'users',
  {
    ...baseColumns(),
    ...softDelete(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    nickname: varchar('nickname', { length: 100 }),
    phone: varchar('phone', { length: 20 }).unique(),
    status: userStatusEnum('status').notNull().default('active'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_users_email').on(t.email),
    index('idx_users_phone').on(t.phone),
    index('idx_users_status').on(t.status),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
  cartItems: many(cartItems),
}));

export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
