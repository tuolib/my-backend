/**
 * User Service 域 — PG Schema: user_service
 * 表: users, user_addresses, refresh_tokens
 */
import {
  boolean,
  index,
  pgSchema,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { baseColumns, softDelete } from './_common';

// ── PG Schema ──
export const userServiceSchema = pgSchema('user_service');

// ── users 表 ──
export const users = userServiceSchema.table(
  'users',
  {
    ...baseColumns(),
    ...softDelete(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    password: varchar('password', { length: 255 }).notNull(),
    nickname: varchar('nickname', { length: 50 }),
    avatarUrl: text('avatar_url'),
    phone: varchar('phone', { length: 20 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    lastLogin: timestamp('last_login', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('idx_users_email').on(t.email),
    index('idx_users_status').on(t.status),
  ],
);

// ── user_addresses 表 ──
export const userAddresses = userServiceSchema.table(
  'user_addresses',
  {
    ...baseColumns(),
    userId: varchar('user_id', { length: 21 }).notNull().references(() => users.id),
    label: varchar('label', { length: 50 }),
    recipient: varchar('recipient', { length: 100 }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    province: varchar('province', { length: 50 }).notNull(),
    city: varchar('city', { length: 50 }).notNull(),
    district: varchar('district', { length: 50 }).notNull(),
    address: text('address').notNull(),
    postalCode: varchar('postal_code', { length: 10 }),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (t) => [
    index('idx_user_addresses_user').on(t.userId),
  ],
);

// ── refresh_tokens 表 ──
export const refreshTokens = userServiceSchema.table(
  'refresh_tokens',
  {
    id: varchar('id', { length: 21 }).primaryKey(),
    userId: varchar('user_id', { length: 21 }).notNull().references(() => users.id),
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_refresh_tokens_user').on(t.userId),
    index('idx_refresh_tokens_expires').on(t.expiresAt),
  ],
);

// ── Relations ──
export const usersRelations = relations(users, ({ many }) => ({
  addresses: many(userAddresses),
  refreshTokens: many(refreshTokens),
}));

export const userAddressesRelations = relations(userAddresses, ({ one }) => ({
  user: one(users, {
    fields: [userAddresses.userId],
    references: [users.id],
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

// ── Types ──
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserAddress = typeof userAddresses.$inferSelect;
export type NewUserAddress = typeof userAddresses.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
