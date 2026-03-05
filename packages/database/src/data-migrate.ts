/**
 * 数据迁移执行器
 * 与 schema 迁移不同，data migration 用于批量数据变更（如补充图片、修正价格等）
 * 每个迁移只执行一次，通过 product_service.data_migrations 表跟踪
 *
 * 用法: bun run data:migrate
 */
import { sql } from 'drizzle-orm';
import { db, connection } from './client';
import { dataMigrations } from './schema';

export interface DataMigrationDef {
  id: string;
  description: string;
  up: () => Promise<void>;
}

/**
 * 注册并执行数据迁移
 * - 按 id 字母序排列，依次执行
 * - 跳过已执行过的迁移
 * - 只更新 data_source='seed' 的记录（Admin 修改过的不碰）
 */
export async function runDataMigrations(migrations: DataMigrationDef[]) {
  // 确保 data_migrations 表存在（schema 迁移可能还没跑）
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS product_service.data_migrations (
      id VARCHAR(100) PRIMARY KEY,
      description VARCHAR(500),
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // 获取已执行的迁移
  const executed = await db.execute(
    sql`SELECT id FROM product_service.data_migrations`
  );
  const executedIds = new Set((executed as any[]).map((r) => r.id));

  // 按 id 排序
  const sorted = [...migrations].sort((a, b) => a.id.localeCompare(b.id));

  let ran = 0;
  for (const migration of sorted) {
    if (executedIds.has(migration.id)) {
      console.log(`  [skip] ${migration.id}: ${migration.description}`);
      continue;
    }

    console.log(`  [run]  ${migration.id}: ${migration.description}`);
    await migration.up();

    // 记录已执行
    await db.insert(dataMigrations).values({
      id: migration.id,
      description: migration.description,
    });
    ran++;
    console.log(`  [done] ${migration.id}`);
  }

  return ran;
}

// ── 自动发现并执行 data-migrations/ 下的所有迁移 ──
async function main() {
  console.log('Data migration: scanning migrations...\n');

  // 动态导入所有迁移文件
  const glob = new Bun.Glob('*.ts');
  const migrationsDir = `${import.meta.dirname}/data-migrations`;
  const files: string[] = [];

  for await (const file of glob.scan(migrationsDir)) {
    files.push(file);
  }
  files.sort();

  if (files.length === 0) {
    console.log('No data migration files found.');
    return;
  }

  const allMigrations: DataMigrationDef[] = [];
  for (const file of files) {
    const mod = await import(`${migrationsDir}/${file}`);
    if (mod.default) {
      allMigrations.push(mod.default);
    } else if (mod.migration) {
      allMigrations.push(mod.migration);
    }
  }

  console.log(`Found ${allMigrations.length} data migrations:\n`);
  const ran = await runDataMigrations(allMigrations);

  console.log(`\nData migration complete: ${ran} new, ${allMigrations.length - ran} skipped.`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Data migration failed:', err);
      process.exit(1);
    });
}
