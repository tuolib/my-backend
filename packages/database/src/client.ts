import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export interface DatabaseConfig {
  url: string;
  poolMax: number;
  poolIdleTimeout: number;
}

let sql: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle> | null = null;

/** 从配置或环境变量初始化连接池 */
export function initDatabase(config?: Partial<DatabaseConfig>) {
  const url = config?.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  sql = postgres(url, {
    max: config?.poolMax ?? (Number(process.env.DB_POOL_MAX) || 20),
    idle_timeout: config?.poolIdleTimeout ?? (Number(process.env.DB_POOL_IDLE_TIMEOUT) || 30),
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
