import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKmlSourcesJson } from './data/kml-update-options.js';
import { normalizeOsmUpdateUrl } from './data/osm-city-update-options.js';
import { loadApplicationDatabaseConnection } from './db/database-environment.js';

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
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} name
 * @param {string[]} allowed
 * @param {string} fallback
 */
function enumValue(env, name, allowed, fallback) {
  const value = env[name]?.trim() || fallback;
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} name
 * @param {string[]} fallback
 */
function listValue(env, name, fallback) {
  const values = (env[name] === undefined ? fallback : env[name].split(','))
    .map((value) => value.trim().toLocaleLowerCase('en-US'))
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value`);
  }
  return [...new Set(values)];
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

  const kmlAllowedHosts = new Set(
    listValue(env, 'KML_UPDATE_ALLOWED_HOSTS', ['www.google.com']),
  );
  const kmlMaxSources = integerValue(env, 'KML_UPDATE_MAX_SOURCES', 10, {
    min: 1,
    max: 100,
  });
  const kmlConstraints = {
    allowedHosts: kmlAllowedHosts,
    maxSources: kmlMaxSources,
  };
  const kmlCityBufferMaxMeters = integerValue(
    env,
    'KML_UPDATE_CITY_BUFFER_MAX_METERS',
    5000,
    { min: 0, max: 50000 },
  );
  const kmlCityBufferMeters = integerValue(
    env,
    'KML_UPDATE_CITY_BUFFER_METERS',
    0,
    { min: 0, max: kmlCityBufferMaxMeters },
  );
  const osmAllowedHosts = new Set(
    listValue(env, 'OSM_CITY_UPDATE_ALLOWED_HOSTS', [
      'overpass-api.de',
      'overpass.kumi.systems',
      'maps.mail.ru',
    ]),
  );
  const osmCityMaxBatchSize = integerValue(
    env,
    'OSM_CITY_UPDATE_MAX_BATCH_SIZE',
    200,
    { min: 1, max: 1000 },
  );
  const osmCityBatchSize = integerValue(
    env,
    'OSM_CITY_UPDATE_BATCH_SIZE',
    50,
    { min: 1, max: osmCityMaxBatchSize },
  );

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
      ...loadApplicationDatabaseConnection(env),
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
    kmlUpdate: {
      ...kmlConstraints,
      sources: parseKmlSourcesJson(env.KML_UPDATE_SOURCES_JSON, kmlConstraints),
      timeoutMs: integerValue(env, 'KML_UPDATE_TIMEOUT_MS', 30000, {
        min: 1000,
        max: 300000,
      }),
      maxFileBytes: integerValue(
        env,
        'KML_UPDATE_MAX_FILE_BYTES',
        10 * 1024 * 1024,
        { min: 1024, max: 250 * 1024 * 1024 },
      ),
      maxTotalBytes: integerValue(
        env,
        'KML_UPDATE_MAX_TOTAL_BYTES',
        50 * 1024 * 1024,
        { min: 1024, max: 500 * 1024 * 1024 },
      ),
      maxRequestBodyBytes: integerValue(
        env,
        'KML_UPDATE_REQUEST_MAX_BODY_BYTES',
        256 * 1024,
        { min: 1024, max: 10 * 1024 * 1024 },
      ),
      cityBufferMeters: kmlCityBufferMeters,
      cityBufferMaxMeters: kmlCityBufferMaxMeters,
      dryRun: booleanValue(env, 'KML_UPDATE_DRY_RUN', false),
      unmatchedPolicy: enumValue(
        env,
        'KML_UPDATE_UNMATCHED_POLICY',
        ['skip', 'fail'],
        'skip',
      ),
      ambiguousPolicy: enumValue(
        env,
        'KML_UPDATE_AMBIGUOUS_POLICY',
        ['best-overlap', 'fail'],
        'best-overlap',
      ),
    },
    osmCityUpdate: {
      allowedHosts: osmAllowedHosts,
      url: normalizeOsmUpdateUrl(
        env.OSM_CITY_UPDATE_URL?.trim() ||
          'https://overpass-api.de/api/interpreter',
        osmAllowedHosts,
      ),
      timeoutMs: integerValue(env, 'OSM_CITY_UPDATE_TIMEOUT_MS', 600000, {
        min: 1000,
        max: 900000,
      }),
      queryTimeoutSeconds: integerValue(
        env,
        'OSM_CITY_UPDATE_QUERY_TIMEOUT_SECONDS',
        300,
        { min: 1, max: 600 },
      ),
      batchSize: osmCityBatchSize,
      maxBatchSize: osmCityMaxBatchSize,
      maxBytes: integerValue(
        env,
        'OSM_CITY_UPDATE_MAX_BYTES',
        300 * 1024 * 1024,
        { min: 1024, max: 500 * 1024 * 1024 },
      ),
      maxRequestBodyBytes: integerValue(
        env,
        'OSM_CITY_UPDATE_REQUEST_MAX_BODY_BYTES',
        16 * 1024,
        { min: 256, max: 1024 * 1024 },
      ),
      dryRun: booleanValue(env, 'OSM_CITY_UPDATE_DRY_RUN', false),
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
