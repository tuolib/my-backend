/**
 * PostgreSQL 连接池（postgres.js + Drizzle ORM）— 读写分离
 * db: 主库连接（读写），dbRead: 从库连接（只读）
 * DATABASE_READ_URL 未配置时 dbRead 自动退化为 db
 * 通过 getConfig() 获取连接配置，禁止直接使用 process.env
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig, createLogger } from '@repo/shared';
import * as schema from './schema';

const config = getConfig();
const log = createLogger('postgres');

// ── 主库连接（读写）──
const connection = postgres(config.database.url, {
  max: config.database.poolMax,
  idle_timeout: config.database.poolIdleTimeout,
  connect_timeout: 5,
});

export const db = drizzle(connection, { schema });
export { connection };

// ── 从库连接（只读）──
const hasReadReplica = config.database.readUrl !== config.database.url;

const readConnection = hasReadReplica
  ? postgres(config.database.readUrl, {
      max: config.database.poolMax,
      idle_timeout: config.database.poolIdleTimeout,
      connect_timeout: 5,
    })
  : connection;

export const dbRead = hasReadReplica ? drizzle(readConnection, { schema }) : db;
export { readConnection };

/**
 * 预热：执行一次查询以建立连接池中的首个连接
 * 避免首次业务请求时才触发连接建立导致延迟
 */
export async function warmupDb(): Promise<void> {
  await connection`SELECT 1`;
  if (hasReadReplica) {
    await readConnection`SELECT 1`;
    log.info('PostgreSQL read/write connection pools warmed up (read replica enabled)');
  } else {
    log.info('PostgreSQL connection pool warmed up (single node, no read replica)');
  }
}
