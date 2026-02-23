// src/db/schema.ts
import { pgTable, serial, text, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(), // 邮箱作为唯一登录标识
  passwordHash: text('password_hash').notNull(), // 存储哈希后的密码，严禁明文
  isActive: boolean('is_active').default(true).notNull(), // 账户状态
  lastLoginAt: timestamp('last_login_at'), // 最后登录时间
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
