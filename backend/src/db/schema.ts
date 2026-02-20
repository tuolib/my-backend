// src/db/schema.ts
import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  // age: integer('age'),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});