import pg from 'pg';

const { Client } = pg;

function booleanValue(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false`);
}

export function createDatabaseClient() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const ssl = booleanValue('DATABASE_SSL', false);
  return new Client({
    connectionString,
    ssl: ssl
      ? {
          rejectUnauthorized: booleanValue(
            'DATABASE_SSL_REJECT_UNAUTHORIZED',
            true,
          ),
        }
      : false,
    application_name: 'dtpstat-buslines-maintenance',
    options: '-c search_path=buslanes,public',
  });
}
