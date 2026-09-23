import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  databaseLockKey,
  loadDatabaseSchema,
} from '../src/db/database-environment.js';
import {
  applyMigrations,
  loadMigrations,
  parseMigrationFileName,
  renderMigrationSql,
  validateMigrationSequence,
} from '../src/db/migration-runner.js';
import { createDatabaseClient } from './database.js';

export {
  applyMigrations,
  loadMigrations,
  parseMigrationFileName,
  renderMigrationSql,
  validateMigrationSequence,
};

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');
const migrationsDirectory = path.join(projectRoot, 'db', 'migrations');

async function main() {
  const migrations = await loadMigrations(migrationsDirectory);
  const schema = loadDatabaseSchema();
  const lockKey = databaseLockKey(schema, 'migrations');
  const client = createDatabaseClient();
  await client.connect();

  try {
    await client.query(
      'SELECT pg_advisory_lock(hashtext($1))',
      [lockKey],
    );
    const result = await applyMigrations(client, migrations, {
      schema,
      logger(event) {
        const prefix = event.status === 'applied'
          ? 'Applied'
          : 'Already applied';
        console.log(`${prefix}: ${event.migration.fileName}`);
      },
    });
    console.log(
      `Schema ${schema} is current at version ${result.version}; ` +
      `applied ${result.appliedCount} migration(s).`,
    );
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
