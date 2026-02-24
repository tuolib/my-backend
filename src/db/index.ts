import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.ts';

const writeDatabaseUrlRaw = process.env.DATABASE_WRITE_URL || process.env.DATABASE_URL;

if (!writeDatabaseUrlRaw) {
  throw new Error('DATABASE_WRITE_URL or DATABASE_URL is not set in environment variables');
}
const writeDatabaseUrl = writeDatabaseUrlRaw;
const readDatabaseUrl = process.env.DATABASE_READ_URL || writeDatabaseUrl;

const poolMax = Number(process.env.DB_POOL_MAX || 20);
const sharedDbUrl = writeDatabaseUrl === readDatabaseUrl;

export const writeClient = postgres(writeDatabaseUrl, {
  max: poolMax,
  prepare: false,
});
export const readClient = sharedDbUrl
  ? writeClient
  : postgres(readDatabaseUrl, {
      max: poolMax,
      prepare: false,
    });

export const dbWrite = drizzle(writeClient, { schema });
export const dbRead = drizzle(readClient, { schema });

// 兼容旧代码，默认使用写库连接
export const db = dbWrite;
export const client = writeClient;

export const checkDatabaseReadiness = async () => {
  await dbWrite.execute(sql`select 1`);
  await dbRead.execute(sql`select 1`);
};

export const closeDbConnections = async () => {
  await writeClient.end();
  if (!sharedDbUrl) {
    await readClient.end();
  }
};
