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

/**
 * 将 Drizzle 生成的 SQL 文件按 "--> statement-breakpoint" 拆分为独立语句
 * 避免通过 postgres 库一次发送超大多语句字符串导致兼容性问题
 */
function splitStatements(content: string): string[] {
  return content
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 创建数据库连接
 * 优先使用独立环境变量（PGHOST/PGPASSWORD 等），避免 URL 编码问题
 * 回退到 DATABASE_URL
 */
function createConnection(databaseUrl?: string): postgres.Sql {
  const pgHost = process.env.PGHOST;
  const pgPassword = process.env.PGPASSWORD;

  if (pgHost && pgPassword) {
    console.log(
      `[migrate] connecting via PG env vars: ${pgHost}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'ecommerce'}`
    );
    return postgres({
      host: pgHost,
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'ecommerce',
      username: process.env.PGUSER || 'postgres',
      password: pgPassword,
      max: 1,
      connect_timeout: 30,
    });
  }

  const url = databaseUrl || process.env.DATABASE_URL;
  if (!url) {
    console.error('[migrate] DATABASE_URL or PGHOST+PGPASSWORD is required');
    process.exit(1);
  }

  const safeUrl = url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
  console.log(`[migrate] connecting via DATABASE_URL: ${safeUrl}`);
  return postgres(url, { max: 1, connect_timeout: 30 });
}

export async function migrate(databaseUrl?: string) {
  const sql = createConnection(databaseUrl);

  try {
    // 1. 创建 PG schema
    await ensurePgSchemas(sql);

    // 2. 确保迁移追踪表存在
    await ensureMigrationsTable(sql);
    const applied = await getAppliedMigrations(sql);
    console.log(`[migrate] already applied: ${[...applied].join(', ') || '(none)'}`);

    // 3. 执行未应用的迁移
    let files: string[];
    try {
      files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    } catch {
      console.log('[migrate] no migrations directory found, skipping');
      return;
    }

    console.log(`[migrate] found ${files.length} migration files: ${files.join(', ')}`);

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] skip (already applied): ${file}`);
        continue;
      }

      console.log(`[migrate] applying: ${file}`);
      const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
      const statements = splitStatements(content);
      console.log(`[migrate]   ${statements.length} statements to execute`);

      await sql.begin(async (tx) => {
        for (let i = 0; i < statements.length; i++) {
          await tx.unsafe(statements[i]);
        }
        await tx.unsafe('INSERT INTO _migrations (name) VALUES ($1)', [file]);
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
  const MAX_RETRIES = 5;
  const RETRY_DELAY = 2000;

  (async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await migrate();
        process.exit(0);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[migrate] attempt ${attempt}/${MAX_RETRIES} failed: ${msg}`);
        if (attempt === MAX_RETRIES) {
          console.error('[migrate] all retries exhausted');
          process.exit(1);
        }
        console.log(`[migrate] retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
      }
    }
  })();
}
