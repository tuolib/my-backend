/**
 * 迁移执行器
 * 1. 创建 3 个 PG schema（如果不存在）
 * 2. 按顺序执行 src/migrations/ 下的 .sql 文件
 * 3. 通过 _migrations 表跟踪已执行的迁移
 *
 * 用法：DATABASE_URL=... bun run src/migrate.ts
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

const PG_SCHEMAS = ['user_service', 'product_service', 'order_service'] as const;

async function ensurePgSchemas(sql: postgres.Sql) {
  for (const schema of PG_SCHEMAS) {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  }
  console.log(`[migrate] PG schemas ensured: ${PG_SCHEMAS.join(', ')}`);
}

async function ensureMigrationsTable(sql: postgres.Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id    SERIAL PRIMARY KEY,
      name  TEXT NOT NULL UNIQUE,
      run_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

async function getAppliedMigrations(sql: postgres.Sql): Promise<Set<string>> {
  const rows = await sql<{ name: string }[]>`SELECT name FROM _migrations ORDER BY id`;
  return new Set(rows.map((r) => r.name));
}

export async function migrate(databaseUrl?: string) {
  const url = databaseUrl || process.env.DATABASE_URL;
  if (!url) {
    console.error('[migrate] DATABASE_URL is required');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });

  try {
    // 1. 创建 PG schema
    await ensurePgSchemas(sql);

    // 2. 确保迁移追踪表存在
    await ensureMigrationsTable(sql);
    const applied = await getAppliedMigrations(sql);

    // 3. 执行未应用的迁移
    let files: string[];
    try {
      files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    } catch {
      console.log('[migrate] no migrations directory found, skipping');
      return;
    }

    for (const file of files) {
      if (applied.has(file)) continue;

      const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });

      console.log(`[migrate] applied: ${file}`);
    }

    console.log('[migrate] done');
  } finally {
    await sql.end();
  }
}

// 直接执行: DATABASE_URL=... bun run packages/database/src/migrate.ts
if (import.meta.main) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}
