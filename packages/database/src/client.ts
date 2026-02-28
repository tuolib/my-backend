/**
 * PostgreSQL 连接池（postgres.js + Drizzle ORM）
 * 通过 getConfig() 获取连接配置，禁止直接使用 process.env
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig } from '@repo/shared';
import * as schema from './schema';

const config = getConfig();

const connection = postgres(config.database.url, {
  max: config.database.poolMax,
  idle_timeout: config.database.poolIdleTimeout,
  connect_timeout: 5,
});

export const db = drizzle(connection, { schema });
export { connection };
