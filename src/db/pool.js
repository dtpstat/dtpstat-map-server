import pg from 'pg';
import { serviceErrorDetails, serviceLog } from '../service-log.js';
import {
  databaseApplicationName,
  databaseSearchPath,
  normalizeDatabaseSchema,
} from './database-environment.js';

const { Pool } = pg;

/**
 * Keep connection-level pg errors from becoming unhandled EventEmitter errors.
 * SQL/query failures still reject their own promises and are handled by the
 * calling route/task. These handlers cover unexpected socket/backend loss,
 * including a pooled client that disconnects while it is checked out.
 *
 * @param {import('pg').Pool} pool
 * @param {string} schema
 * @param {(message: string, details: object) => void} [logError]
 */
export function attachPoolErrorHandlers(
  pool,
  schema,
  logError = (_message, details) => serviceLog('error', 'postgres.connection:error', details),
) {
  const reported = new WeakSet();

  /** @param {unknown} error @param {any} client */
  const report = (error, client) => {
    if (error && typeof error === 'object') {
      if (reported.has(error)) return;
      reported.add(error);
    }
    logError('Unexpected PostgreSQL connection error', {
      schema,
      processId: client?.processID ?? null,
      ...serviceErrorDetails(error),
    });
  };

  // pg Pool forwards idle-client failures through its own error event.
  pool.on('error', (error, client) => report(error, client));

  // Keep a permanent listener on every physical client as well. pg removes its
  // idle listener while a client is checked out, so a socket failure between
  // queries must not become an unhandled Client#error event.
  pool.on('connect', (client) => {
    client.on('error', (error) => report(error, client));
  });

  return pool;
}

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
  attachPoolErrorHandlers(pool, schema);
  return pool;
}
