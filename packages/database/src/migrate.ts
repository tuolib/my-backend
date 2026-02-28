import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { getSql } from './client';

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

async function ensureMigrationsTable(sql: ReturnType<typeof postgres>) {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id    SERIAL PRIMARY KEY,
      name  TEXT NOT NULL UNIQUE,
      run_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

async function getAppliedMigrations(sql: ReturnType<typeof postgres>): Promise<Set<string>> {
  const rows = await sql<{ name: string }[]>`SELECT name FROM _migrations ORDER BY id`;
  return new Set(rows.map((r) => r.name));
}

/** 执行迁移（需要先调用 initDatabase） */
export async function migrate() {
  const sql = getSql();
  await ensureMigrationsTable(sql);
  const applied = await getAppliedMigrations(sql);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    await sql.begin(async (tx: any) => {
      await tx.unsafe(content);
      await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    });

    console.log(`[migrate] applied: ${file}`);
  }

  console.log('[migrate] done');
}

// 直接执行: bun run packages/database/src/migrate.ts
if (import.meta.main) {
  const { initDatabase } = await import('./client');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[migrate] DATABASE_URL is required');
    process.exit(1);
  }
  initDatabase({ url, poolMax: 5, poolIdleTimeout: 30 });

  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}
