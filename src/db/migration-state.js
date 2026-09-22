import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeDatabaseSchema } from './database-environment.js';

const MIGRATION_FILE = /^V(\d{3})__([a-z0-9][a-z0-9_-]*)\.sql$/i;

function migrationVersion(fileName) {
  const match = MIGRATION_FILE.exec(fileName);
  return match ? Number(match[1]) : null;
}

export async function expectedMigrationState(projectRoot) {
  const directory = path.join(projectRoot, 'db', 'migrations');
  const files = await fs.readdir(directory);
  const migrations = files
    .map((fileName) => ({
      fileName,
      version: migrationVersion(fileName),
    }))
    .filter((item) => item.version !== null)
    .sort((left, right) => left.version - right.version);

  if (migrations.length === 0) {
    throw new Error('No versioned database migrations found');
  }

  for (const [index, migration] of migrations.entries()) {
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new Error(
        `Migration sequence must be contiguous: expected V${String(expected).padStart(3, '0')}, found ${migration.fileName}`,
      );
    }
  }

  return {
    version: migrations.at(-1).version,
    fileName: migrations.at(-1).fileName,
    count: migrations.length,
  };
}

function historyTable(schema) {
  return `${normalizeDatabaseSchema(schema)}.schema_versions`;
}

export async function verifyDatabaseMigrationState(
  database,
  {
    projectRoot,
    schema = database.databaseSchema,
  },
) {
  const expected = await expectedMigrationState(projectRoot);
  const normalizedSchema = normalizeDatabaseSchema(schema);
  const table = historyTable(normalizedSchema);

  const exists = await database.query(
    'SELECT to_regclass($1) AS history',
    [table],
  );
  if (!exists.rows[0]?.history) {
    throw new Error(
      `Database schema ${normalizedSchema} has no migration history; run npm run db:migrate before starting the server`,
    );
  }

  const result = await database.query(`
    SELECT
      COUNT(*)::integer AS count,
      COALESCE(MAX(version), 0)::integer AS "currentVersion",
      (
        SELECT filename
        FROM ${table}
        ORDER BY version DESC
        LIMIT 1
      ) AS "currentFile"
    FROM ${table}
  `);
  const state = result.rows[0] ?? {
    count: 0,
    currentVersion: 0,
    currentFile: null,
  };

  if (state.count !== state.currentVersion) {
    throw new Error(
      `Database migration history for schema ${normalizedSchema} has a gap: ` +
      `${state.count} recorded migrations through V${String(state.currentVersion).padStart(3, '0')}`,
    );
  }

  if (state.currentVersion < expected.version) {
    throw new Error(
      `Database schema ${normalizedSchema} is at V${String(state.currentVersion).padStart(3, '0')} ` +
      `(${state.currentFile ?? 'no migration'}), but application requires ` +
      `V${String(expected.version).padStart(3, '0')} (${expected.fileName}); ` +
      'run npm run db:migrate before starting the server',
    );
  }

  if (state.currentVersion > expected.version) {
    throw new Error(
      `Database schema ${normalizedSchema} is at V${String(state.currentVersion).padStart(3, '0')}, ` +
      `but this application only knows through V${String(expected.version).padStart(3, '0')}; deploy matching/newer application code`,
    );
  }

  if (state.currentFile !== expected.fileName) {
    throw new Error(
      `Database migration history mismatch at V${String(expected.version).padStart(3, '0')}: ` +
      `expected ${expected.fileName}, found ${state.currentFile ?? 'NULL'}`,
    );
  }

  return {
    schema: normalizedSchema,
    currentVersion: state.currentVersion,
    currentFile: state.currentFile,
    expectedVersion: expected.version,
    expectedFile: expected.fileName,
  };
}
