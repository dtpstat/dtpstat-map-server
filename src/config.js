import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

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

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} name
 * @param {number} fallback
 * @param {{ min?: number, max?: number }} [range]
 */
function integerValue(env, name, fallback, range = {}) {
  const raw = env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  const min = range.min ?? Number.MIN_SAFE_INTEGER;
  const max = range.max ?? Number.MAX_SAFE_INTEGER;

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return value;
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
 * Read and validate the complete runtime configuration.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string} [projectRoot]
 */
export function loadConfig(env = process.env, projectRoot = DEFAULT_PROJECT_ROOT) {
  const httpEnabled = booleanValue(env, 'HTTP_ENABLED', true);
  const httpsEnabled = booleanValue(env, 'HTTPS_ENABLED', false);

  if (!httpEnabled && !httpsEnabled) {
    throw new Error('At least one of HTTP_ENABLED or HTTPS_ENABLED must be true');
  }

  const httpPort = integerValue(
    env,
    env.HTTP_PORT === undefined && env.PORT !== undefined ? 'PORT' : 'HTTP_PORT',
    3000,
    { min: 1, max: 65535 },
  );
  const httpsPort = integerValue(env, 'HTTPS_PORT', 3443, {
    min: 1,
    max: 65535,
  });

  if (httpEnabled && httpsEnabled && httpPort === httpsPort) {
    throw new Error('HTTP_PORT and HTTPS_PORT must be different');
  }

  const keyPath = httpsEnabled
    ? path.resolve(projectRoot, requiredValue(env, 'HTTPS_KEY_PATH'))
    : null;
  const certPath = httpsEnabled
    ? path.resolve(projectRoot, requiredValue(env, 'HTTPS_CERT_PATH'))
    : null;

  return {
    environment: env.NODE_ENV?.trim() || 'development',
    host: env.HOST?.trim() || '0.0.0.0',
    projectRoot,
    http: {
      enabled: httpEnabled,
      port: httpPort,
    },
    https: {
      enabled: httpsEnabled,
      port: httpsPort,
      keyPath,
      certPath,
    },
    database: {
      connectionString: requiredValue(env, 'DATABASE_URL'),
      ssl: booleanValue(env, 'DATABASE_SSL', false),
      rejectUnauthorized: booleanValue(
        env,
        'DATABASE_SSL_REJECT_UNAUTHORIZED',
        true,
      ),
      maxConnections: integerValue(env, 'DATABASE_POOL_MAX', 10, {
        min: 1,
        max: 100,
      }),
    },
    importApi: {
      username: requiredValue(env, 'IMPORT_API_USERNAME'),
      password: requiredValue(env, 'IMPORT_API_PASSWORD'),
      maxBodyBytes: integerValue(
        env,
        'IMPORT_API_MAX_BODY_BYTES',
        25 * 1024 * 1024,
        { min: 1024, max: 250 * 1024 * 1024 },
      ),
    },
    publicMap: {
      accessToken: requiredValue(env, 'MAPBOX_ACCESS_TOKEN'),
      styleUrl:
        env.MAPBOX_STYLE_URL?.trim() ||
        'mapbox://styles/culebron/cj7ornxjab8oq2spdw84gxob0',
      initialCenter: [49.1245, 55.7836],
      initialZoom: 12,
    },
  };
}

export const projectRoot = DEFAULT_PROJECT_ROOT;
