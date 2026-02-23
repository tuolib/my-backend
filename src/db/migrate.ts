import { readdir } from "fs/promises"
import { readFile } from "fs/promises"
import path from "path"
import { sql } from "drizzle-orm"
import { db, client } from "./index.ts"

const migrationsDir = path.join(process.cwd(), "migrations")

async function ensureMigrationsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)
}

async function getAppliedMigrations(): Promise<string[]> {
  const res = await db.execute(
    sql`SELECT version FROM schema_migrations ORDER BY version`
  )
  const rows = Array.isArray(res)
    ? res
    : ((res as { rows?: Array<{ version: string }> }).rows ?? [])
  return rows.map(r => String((r as { version: string }).version))
}

async function applyMigration(version: string, migrationSql: string) {
  console.log(`Applying ${version}`)
  await db.transaction(async tx => {
    await tx.execute(sql.raw(migrationSql))
    await tx.execute(
      sql`INSERT INTO schema_migrations(version) VALUES(${version})`
    )
  })
}

async function rollbackMigration(version: string, migrationSql: string) {
  console.log(`Rolling back ${version}`)
  await db.transaction(async tx => {
    await tx.execute(sql.raw(migrationSql))
    await tx.execute(
      sql`DELETE FROM schema_migrations WHERE version = ${version}`
    )
  })
}

async function migrateUp() {
  const files = (await readdir(migrationsDir))
    .filter(f => f.endsWith(".up.sql"))
    .sort()

  const applied = await getAppliedMigrations()

  for (const file of files) {
    const version = file.replace(".up.sql", "")
    if (!applied.includes(version)) {
      const sql = await readFile(path.join(migrationsDir, file), "utf-8")
      await applyMigration(version, sql)
    }
  }

  console.log("✅ Migrations complete")
}

async function migrateDown() {
  const applied = await getAppliedMigrations()
  if (applied.length === 0) {
    console.log("No migrations to rollback")
    return
  }

  const lastVersion = applied[applied.length - 1]
  const downFile = `${lastVersion}.down.sql`
  const sql = await readFile(path.join(migrationsDir, downFile), "utf-8")

  await rollbackMigration(lastVersion, sql)

  console.log(`⬇ Rolled back ${lastVersion}`)
}

async function main() {
  try {
    await ensureMigrationsTable()

    if (process.argv.includes("--down")) {
      await migrateDown()
    } else {
      await migrateUp()
    }
  } finally {
    await client.end()
  }
}

main()
