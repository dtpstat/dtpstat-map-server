import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from './database.js';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');
const migrationsDirectory = path.join(projectRoot, 'db', 'migrations');
const MIGRATION_FILE = /^V(\d{3})__([a-z0-9][a-z0-9_-]*)\.sql$/i;

/** @param {string} fileName */
export function parseMigrationFileName(fileName) {
  const match = MIGRATION_FILE.exec(fileName);
  if (!match) return null;
  return {
    version: Number(match[1]),
    fileName,
    name: match[2],
  };
}

/** @param {Array<{ version: number, fileName: string }>} migrations */
export function validateMigrationSequence(migrations) {
  if (migrations.length === 0) {
    throw new Error('No versioned migrations found');
  }

  const sorted = [...migrations].sort((left, right) => left.version - right.version);
  for (const [index, migration] of sorted.entries()) {
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new Error(
        `Migration sequence must be contiguous: expected V${String(expected).padStart(3, '0')}, found ${migration.fileName}`,
      );
    }
  }
  return sorted;
}

export async function loadMigrations(directory = migrationsDirectory) {
  const entries = await fs.readdir(directory);
  const parsed = entries
    .map(parseMigrationFileName)
    .filter((migration) => migration !== null);
  const migrations = validateMigrationSequence(parsed);

  return Promise.all(
    migrations.map(async (migration) => {
      const sql = await fs.readFile(
        path.join(directory, migration.fileName),
        'utf8',
      );
      return {
        ...migration,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

/**
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} client
 * @param {Awaited<ReturnType<typeof loadMigrations>>} migrations
 */
export async function applyMigrations(client, migrations) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.buslanes_schema_versions (
      version integer PRIMARY KEY CHECK (version > 0),
      filename text NOT NULL UNIQUE,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const appliedResult = await client.query(`
    SELECT version, filename, checksum
    FROM public.buslanes_schema_versions
    ORDER BY version
  `);
  const appliedRows = appliedResult.rows;
  for (const [index, row] of appliedRows.entries()) {
    const expected = index + 1;
    if (row.version !== expected) {
      throw new Error(
        `Database migration history has a gap before version ${row.version}`,
      );
    }

    const migration = migrations.find((item) => item.version === row.version);
    if (!migration) {
      throw new Error(
        `Database schema version ${row.version} is newer than this application`,
      );
    }
    if (row.filename !== migration.fileName || row.checksum !== migration.checksum) {
      throw new Error(`Applied migration was modified: ${row.filename}`);
    }
  }

  const currentVersion = appliedRows.at(-1)?.version ?? 0;
  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      console.log(`Already applied: ${migration.fileName}`);
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO public.buslanes_schema_versions (
           version,
           filename,
           name,
           checksum
         ) VALUES ($1, $2, $3, $4)`,
        [
          migration.version,
          migration.fileName,
          migration.name,
          migration.checksum,
        ],
      );
      await client.query('COMMIT');
      console.log(`Applied: ${migration.fileName}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  return migrations.at(-1).version;
}

async function main() {
  const migrations = await loadMigrations();
  const client = createDatabaseClient();
  await client.connect();

  try {
    await client.query(
      `SELECT pg_advisory_lock(hashtext('dtpstat-buslines:migrations'))`,
    );
    const version = await applyMigrations(client, migrations);
    console.log(`Schema is current at version ${version}.`);
  } finally {
    await client.query(
      `SELECT pg_advisory_unlock(hashtext('dtpstat-buslines:migrations'))`,
    ).catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error('Migration failed', error);
    process.exitCode = 1;
  });
}
