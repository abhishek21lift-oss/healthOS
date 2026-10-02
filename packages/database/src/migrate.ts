import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);
async function ensureMigrationTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}
/** Cross-session lock so parallel test runners do not race CREATE TYPE/DDL. */
const MIGRATION_LOCK_KEY = 4_200_111;

export function listMigrationFiles(dir: string = migrationsDir): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export async function runMigrations(pool: pg.Pool, dir: string = migrationsDir): Promise<string[]> {
  const files = listMigrationFiles(dir);
  const applied = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    await ensureMigrationTable(client);
    const existing = await client.query('SELECT filename FROM schema_migrations');
    const done = new Set(existing.rows.map((r) => r.filename));
    for (const file of files) {
      if (done.has(file)) {
        continue;
      }
      const sql = readFileSync(path.join(dir, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      applied.push(file);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return applied;
}
