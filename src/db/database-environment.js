export const DEFAULT_DATABASE_SCHEMA = 'buslanes';

const DATABASE_SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * DATABASE_SCHEMA is intentionally restricted to a simple lower-case
 * PostgreSQL identifier. Besides keeping SQL interpolation safe, this value is
 * also used as the technical namespace for one deployed application instance.
 *
 * @param {string | undefined | null} value
 */
export function normalizeDatabaseSchema(value) {
  const schema = String(value ?? '').trim() || DEFAULT_DATABASE_SCHEMA;
  if (!DATABASE_SCHEMA_PATTERN.test(schema)) {
    throw new Error(
      'DATABASE_SCHEMA must be a lower-case PostgreSQL identifier ' +
      '(letters, digits and underscore; first character cannot be a digit)',
    );
  }
  if (
    schema === 'public' ||
    schema === 'information_schema' ||
    schema.startsWith('pg_')
  ) {
    throw new Error('DATABASE_SCHEMA must be a dedicated application schema');
  }
  return schema;
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env] */
export function loadDatabaseSchema(env = process.env) {
  return normalizeDatabaseSchema(env.DATABASE_SCHEMA);
}

/** @param {string | undefined | null} schema */
export function databaseSearchPath(schema) {
  return `-c search_path=${normalizeDatabaseSchema(schema)},public`;
}

/**
 * PostgreSQL application_name is diagnostic only, but namespacing it makes
 * multiple clones on the same server easy to distinguish in pg_stat_activity.
 *
 * @param {string | undefined | null} schema
 * @param {string} component
 */
export function databaseApplicationName(schema, component) {
  const namespace = normalizeDatabaseSchema(schema);
  const suffix = String(component ?? '').trim();
  if (!/^[a-z0-9][a-z0-9:_-]{0,62}$/i.test(suffix)) {
    throw new Error('Database application component name is invalid');
  }
  return `${namespace}:${suffix}`.slice(0, 63);
}

/**
 * Advisory-lock keys are scoped by DATABASE_SCHEMA. This is mostly useful when
 * several instances share one PostgreSQL database; separate databases are
 * isolated by PostgreSQL already.
 *
 * @param {string | undefined | null} schema
 * @param {string} resource
 */
export function databaseLockKey(schema, resource) {
  const namespace = normalizeDatabaseSchema(schema);
  const name = String(resource ?? '').trim();
  if (!/^[a-z0-9][a-z0-9:_-]{0,62}$/i.test(name)) {
    throw new Error('Database lock resource name is invalid');
  }
  return `${namespace}:${name}`;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} name
 */
function requiredValue(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * Passwords are not trimmed because whitespace may intentionally be part of a
 * password. A whitespace-only value is still rejected.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} name
 */
function requiredSecret(env, name) {
  const value = env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} name
 * @param {number} fallback
 */
function portValue(env, name, fallback) {
  const raw = env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} name
 * @param {boolean} fallback
 */
function booleanValue(env, name, fallback) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false`);
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
function commonConnection(env) {
  const sslEnabled = booleanValue(env, 'DATABASE_SSL', false);
  return {
    host: env.DATABASE_HOST?.trim() || '127.0.0.1',
    port: portValue(env, 'DATABASE_PORT', 5432),
    ssl: sslEnabled
      ? {
          rejectUnauthorized: booleanValue(
            env,
            'DATABASE_SSL_REJECT_UNAUTHORIZED',
            true,
          ),
        }
      : false,
  };
}

/**
 * Connection used by the server, migrations, and data imports.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function loadApplicationDatabaseConnection(env = process.env) {
  return {
    ...commonConnection(env),
    database: requiredValue(env, 'DATABASE_NAME'),
    user: requiredValue(env, 'DATABASE_ROLE'),
    password: requiredSecret(env, 'DATABASE_ROLE_PASSWORD'),
  };
}

/**
 * Superuser connection used only by `npm run db:init`.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function loadAdminDatabaseConnection(env = process.env) {
  const user = env.POSTGRES_ADMIN_USER?.trim() || 'postgres';
  if (user !== 'postgres') {
    throw new Error('POSTGRES_ADMIN_USER must be postgres');
  }

  return {
    ...commonConnection(env),
    database: env.POSTGRES_ADMIN_DATABASE?.trim() || 'postgres',
    user,
    password: requiredSecret(env, 'POSTGRES_ADMIN_PASSWORD'),
  };
}
