import { Client } from "pg"
import { readdir } from "fs/promises"
import { readFile } from "fs/promises"
import path from "path"

const client = new Client({
  connectionString: process.env.DATABASE_URL,
})

const migrationsDir = path.join(process.cwd(), "migrations")

async function ensureMigrationsTable() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)
}

async function getAppliedMigrations(): Promise<string[]> {
  const res = await client.query(
    `SELECT version FROM schema_migrations ORDER BY version`
  )
  return res.rows.map(r => r.version)
}

async function applyMigration(version: string, sql: string) {
  console.log(`Applying ${version}`)
  await client.query("BEGIN")
  try {
    await client.query(sql)
    await client.query(
      `INSERT INTO schema_migrations(version) VALUES($1)`,
      [version]
    )
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  }
}

async function rollbackMigration(version: string, sql: string) {
  console.log(`Rolling back ${version}`)
  await client.query("BEGIN")
  try {
    await client.query(sql)
    await client.query(
      `DELETE FROM schema_migrations WHERE version = $1`,
      [version]
    )
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  }
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
  await client.connect()
  await ensureMigrationsTable()

  if (process.argv.includes("--down")) {
    await migrateDown()
  } else {
    await migrateUp()
  }

  await client.end()
}

main()