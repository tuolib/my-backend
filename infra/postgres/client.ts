// infra/postgres/client.ts
import { Pool } from 'pg';

export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(sql: string, params?: any[]) {
  return pgPool.query(sql, params);
}
