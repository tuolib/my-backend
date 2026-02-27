import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from './pg-client';

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

async function ensureMigrationsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id    SERIAL PRIMARY KEY,
      name  TEXT NOT NULL UNIQUE,
      run_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const rows = await sql<{ name: string }[]>`SELECT name FROM _migrations ORDER BY id`;
  return new Set(rows.map((r) => r.name));
}

export async function migrate() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

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
}

// 直接执行: bun run packages/database/src/migrate.ts
if (import.meta.main) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}
