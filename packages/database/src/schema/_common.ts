/**
 * 公共字段构建器
 * 所有表共享的基础字段 + 软删除 + 乐观锁
 */
import { integer, timestamp, varchar } from 'drizzle-orm/pg-core';

/** 基础字段：id (nanoid 21位) + created_at + updated_at */
export function baseColumns() {
  return {
    id: varchar('id', { length: 21 }).primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  };
}

/** 软删除字段 */
export function softDelete() {
  return {
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  };
}

/** 乐观锁版本字段 */
export function optimisticLock() {
  return {
    version: integer('version').notNull().default(0),
  };
}
