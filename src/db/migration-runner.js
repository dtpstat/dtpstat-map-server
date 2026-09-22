import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_DATABASE_SCHEMA,
  databaseLockKey,
  normalizeDatabaseSchema,
} from './database-environment.js';

const MIGRATION_FILE = /^V(\d{3})__([a-z0-9][a-z0-9_-]*)\.sql$/i;
const LEGACY_HISTORY_TABLE = 'public.buslanes_schema_versions';

export function parseMigrationFileName(fileName) {
  const match = MIGRATION_FILE.exec(fileName);
  if (!match) return null;
  return {
    version: Number(match[1]),
    fileName,
    name: match[2],
  };
}

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

export async function loadMigrations(directory) {
  const entries = await fs.readdir(directory);
  const parsed = entries
    .map(parseMigrationFileName)
    .filter((migration) => migration !== null);
  const migrations = validateMigrationSequence(parsed);

  return Promise.all(
    migrations.map(async (migration) => {
      const sql = await fs.readFile(path.join(directory, migration.fileName), 'utf8');
      return {
        ...migration,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

export function renderMigrationSql(sql, schema = DEFAULT_DATABASE_SCHEMA) {
  const target = normalizeDatabaseSchema(schema);
  return sql.replace(/\bBUSLANES\b/gi, target);
}

function migrationHistoryTable(schema) {
  return `${normalizeDatabaseSchema(schema)}.schema_versions`;
}

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
      'SELECT to_regclass($1) AS legacy',
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

export async function applyMigrations(client, migrations, options = {}) {
  const schema = normalizeDatabaseSchema(options.schema);
  const logger = options.logger ?? (() => {});
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
  let appliedCount = 0;
  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      logger({
        status: 'already-applied',
        migration,
      });
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
      appliedCount += 1;
      logger({
        status: 'applied',
        migration,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  return {
    version: migrations.at(-1).version,
    appliedCount,
    totalCount: migrations.length,
  };
}

export async function migrateDatabase(
  database,
  {
    projectRoot,
    schema = database.databaseSchema,
    logger,
  },
) {
  const normalizedSchema = normalizeDatabaseSchema(schema);
  const migrations = await loadMigrations(
    path.join(projectRoot, 'db', 'migrations'),
  );
  const client = await database.connect();
  const lockKey = databaseLockKey(normalizedSchema, 'migrations');

  try {
    await client.query(
      'SELECT pg_advisory_lock(hashtext($1))',
      [lockKey],
    );
    return await applyMigrations(client, migrations, {
      schema: normalizedSchema,
      logger,
    });
  } finally {
    await client.query(
      'SELECT pg_advisory_unlock(hashtext($1))',
      [lockKey],
    ).catch(() => {});
    if (typeof client.release === 'function') {
      client.release();
    } else if (typeof client.end === 'function') {
      await client.end().catch(() => {});
    }
  }
}
