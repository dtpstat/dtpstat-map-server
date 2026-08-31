import pg from 'pg';

const { Pool } = pg;

/**
 * @param {{ connectionString: string, ssl: boolean, rejectUnauthorized: boolean, maxConnections: number }} config
 */
export function createPool(config) {
  return new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections,
    ssl: config.ssl
      ? { rejectUnauthorized: config.rejectUnauthorized }
      : false,
    application_name: 'dtpstat-buslines',
    options: '-c search_path=buslanes,public',
  });
}
