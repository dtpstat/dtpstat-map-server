import pg from 'pg';
import {
  databaseApplicationName,
  databaseSearchPath,
  normalizeDatabaseSchema,
} from './database-environment.js';

const { Pool } = pg;

/**
 * @param {{ host: string, port: number, database: string, user: string, password: string, ssl: false | { rejectUnauthorized: boolean }, maxConnections: number, schema?: string }} config
 */
export function createPool(config) {
  const schema = normalizeDatabaseSchema(config.schema);
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.maxConnections,
    ssl: config.ssl,
    application_name: databaseApplicationName(schema, 'server'),
    options: databaseSearchPath(schema),
  });
  pool.databaseSchema = schema;
  return pool;
}
