import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { RuntimeConfig } from '@repo/shared/config';

let sql: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle> | null = null;

/** 从 RuntimeConfig 初始化连接池 */
export function initDatabase(config: RuntimeConfig['database']) {
  sql = postgres(config.url, {
    max: config.poolMax,
    idle_timeout: config.poolIdleTimeout,
    connect_timeout: 10,
  });
  db = drizzle(sql);
  return { db, sql };
}

/** 获取 Drizzle ORM 实例 */
export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

/** 获取 postgres.js 底层连接池 */
export function getSql() {
  if (!sql) throw new Error('Database not initialized. Call initDatabase() first.');
  return sql;
}

/** 关闭连接池 */
export async function closeDatabase() {
  if (sql) {
    await sql.end();
    sql = null;
    db = null;
  }
}
