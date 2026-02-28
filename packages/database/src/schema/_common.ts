import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';

/** 基础字段：id + 时间戳 */
export function baseColumns() {
  return {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  };
}

/** 软删除字段 */
export function softDelete() {
  return {
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  };
}

/** 乐观锁版本字段 */
export function optimisticLock() {
  return {
    version: integer('version').notNull().default(1),
  };
}
