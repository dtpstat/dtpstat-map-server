import pg from 'pg';
import {
  databaseApplicationName,
  databaseSearchPath,
  loadApplicationDatabaseConnection,
  loadDatabaseSchema,
} from '../src/db/database-environment.js';

const { Client } = pg;

export function createDatabaseClient() {
  const schema = loadDatabaseSchema();
  return new Client({
    ...loadApplicationDatabaseConnection(),
    application_name: databaseApplicationName(schema, 'maintenance'),
    options: databaseSearchPath(schema),
  });
}
