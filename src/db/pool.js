import pg from 'pg';

const { Pool } = pg;

/**
 * @param {{ host: string, port: number, database: string, user: string, password: string, ssl: false | { rejectUnauthorized: boolean }, maxConnections: number }} config
 */
export function createPool(config) {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.maxConnections,
    ssl: config.ssl,
    application_name: 'dtpstat-buslines',
    options: '-c search_path=buslanes,public',
  });
}
