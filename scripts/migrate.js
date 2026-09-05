import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DATABASE_SCHEMA,
  databaseLockKey,
  loadDatabaseSchema,
  normalizeDatabaseSchema,
} from '../src/db/database-environment.js';
import { createDatabaseClient } from './database.js';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');
const migrationsDirectory = path.join(projectRoot, 'db', 'migrations');
const MIGRATION_FILE = /^V(\d{3})__([a-z0-9][a-z0-9_-]*)\.sql$/i;
const LEGACY_HISTORY_TABLE = 'public.buslanes_schema_versions';

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
        // Checksum is always calculated from the immutable repository file.
        // DATABASE_SCHEMA substitution happens only immediately before execute.
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

/**
 * Historical migrations use BUSLANES as a schema token. Do not rewrite those
 * files: existing installations verify their checksums. Instead substitute the
 * configured, strictly validated identifier at execution time.
 *
 * @param {string} sql
 * @param {string} [schema]
 */
export function renderMigrationSql(sql, schema = DEFAULT_DATABASE_SCHEMA) {
  const target = normalizeDatabaseSchema(schema);
  return sql.replace(/\bBUSLANES\b/gi, target);
}

/** @param {string} schema */
function migrationHistoryTable(schema) {
  return `${normalizeDatabaseSchema(schema)}.schema_versions`;
}

/**
 * Migration history is now local to DATABASE_SCHEMA. For the default schema,
 * transparently copy the old public.buslanes_schema_versions history once so
 * existing databases continue without modifying any applied migration.
 *
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} client
 * @param {string} schema
 */
async function ensureMigrationHistory(client, schema) {
  const target = normalizeDatabaseSchema(schema);
  const historyTable = migrationHistoryTable(target);

  await client.query(`CREATE SCHEMA IF NOT EXISTS ${target}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${historyTable} (
      version integer PRIMARY KEY CHECK (version > 0),
      filename text NOT NULL UNIQUE,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  if (target === DEFAULT_DATABASE_SCHEMA) {
    const legacyResult = await client.query(
      `SELECT to_regclass($1) AS legacy`,
      [LEGACY_HISTORY_TABLE],
    );
    if (legacyResult.rows[0]?.legacy) {
      await client.query(`
        INSERT INTO ${historyTable} (
          version,
          filename,
          name,
          checksum,
          applied_at
        )
        SELECT
          version,
          filename,
          name,
          checksum,
          applied_at
        FROM ${LEGACY_HISTORY_TABLE}
        ON CONFLICT (version) DO NOTHING
      `);
    }
  }

  return historyTable;
}

/**
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} client
 * @param {Awaited<ReturnType<typeof loadMigrations>>} migrations
 * @param {{ schema?: string }} [options]
 */
export async function applyMigrations(client, migrations, options = {}) {
  const schema = normalizeDatabaseSchema(options.schema);
  const historyTable = await ensureMigrationHistory(client, schema);

  const appliedResult = await client.query(`
    SELECT version, filename, checksum
    FROM ${historyTable}
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
      await client.query(renderMigrationSql(migration.sql, schema));
      await client.query(
        `INSERT INTO ${historyTable} (
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
  const schema = loadDatabaseSchema();
  const lockKey = databaseLockKey(schema, 'migrations');
  const client = createDatabaseClient();
  await client.connect();

  try {
    await client.query(
      'SELECT pg_advisory_lock(hashtext($1))',
      [lockKey],
    );
    const version = await applyMigrations(client, migrations, { schema });
    console.log(`Schema ${schema} is current at version ${version}.`);
  } finally {
    await client.query(
      'SELECT pg_advisory_unlock(hashtext($1))',
      [lockKey],
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
