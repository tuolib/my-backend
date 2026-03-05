/**
 * Admin Service 域 — PG Schema: admin_service
 * 表: admins
 * 后台管理员独立于 C 端用户，使用 username 登录
 */
import {
  boolean,
  index,
  integer,
  pgSchema,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './_common';

// ── PG Schema ──
export const adminServiceSchema = pgSchema('admin_service');

// ── admins 表 ──
export const admins = adminServiceSchema.table(
  'admins',
  {
    ...baseColumns(),
    username: varchar('username', { length: 50 }).notNull().unique(),
    password: varchar('password', { length: 255 }).notNull(),
    realName: varchar('real_name', { length: 50 }),
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 255 }),
    role: varchar('role', { length: 20 }).notNull().default('admin'),
    isSuper: boolean('is_super').notNull().default(false),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    loginFailCount: integer('login_fail_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('idx_admins_username').on(t.username),
    index('idx_admins_status').on(t.status),
  ],
);

// ── Types ──
export type Admin = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;
