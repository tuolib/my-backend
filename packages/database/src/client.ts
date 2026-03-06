/**
 * PostgreSQL 连接池（postgres.js + Drizzle ORM）
 * 通过 getConfig() 获取连接配置，禁止直接使用 process.env
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig, createLogger } from '@repo/shared';
import * as schema from './schema';

const config = getConfig();
const log = createLogger('postgres');

const connection = postgres(config.database.url, {
  max: config.database.poolMax,
  idle_timeout: config.database.poolIdleTimeout,
  connect_timeout: 5,
});

export const db = drizzle(connection, { schema });
export { connection };

/**
 * 预热：执行一次查询以建立连接池中的首个连接
 * 避免首次业务请求时才触发连接建立导致延迟
 */
export async function warmupDb(): Promise<void> {
  await connection`SELECT 1`;
  log.info('PostgreSQL connection pool warmed up');
}
