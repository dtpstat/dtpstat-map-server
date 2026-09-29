import pg from 'pg';
import {
  databaseApplicationName,
  databaseSearchPath,
  loadApplicationDatabaseConnection,
  loadDatabaseSchema,
  loadMigrationDatabaseConnection,
} from '../src/db/database-environment.js';

const { Client } = pg;

function createClient(
  connection,
  schema,
  component,
) {
  return new Client({
    ...connection,
    application_name:
      databaseApplicationName(
        schema,
        component,
      ),
    options:
      databaseSearchPath(
        schema,
      ),
  });
}

export function createDatabaseClient() {
  const schema =
    loadDatabaseSchema();

  return createClient(
    loadApplicationDatabaseConnection(),
    schema,
    'maintenance',
  );
}

export function createMigrationDatabaseClient() {
  const schema =
    loadDatabaseSchema();

  return createClient(
    loadMigrationDatabaseConnection(),
    schema,
    'migration-cli',
  );
}
