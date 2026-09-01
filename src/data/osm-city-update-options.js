export class OsmCityUpdateValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OsmCityUpdateValidationError';
  }
}

/** @param {unknown} value */
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} rawUrl @param {Set<string>} allowedHosts */
export function normalizeOsmUpdateUrl(rawUrl, allowedHosts) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OsmCityUpdateValidationError(`Invalid OSM URL: ${rawUrl}`);
  }
  if (url.protocol !== 'https:') {
    throw new OsmCityUpdateValidationError('OSM update URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new OsmCityUpdateValidationError(
      'OSM update URL must not contain credentials',
    );
  }
  const host = url.hostname.toLocaleLowerCase('en-US');
  if (!allowedHosts.has(host)) {
    throw new OsmCityUpdateValidationError(`OSM host is not allowed: ${host}`);
  }
  url.hash = '';
  return url.toString();
}

/**
 * @param {unknown} body
 * @param {Set<string>} allowedHosts
 * @param {Set<string> | undefined} allowedURLs
 * @param {string} fallback
 */
function resolveUrl(body, allowedHosts, allowedURLs, fallback) {
  if (body === undefined) return fallback;
  if (!plainObject(body)) {
    throw new OsmCityUpdateValidationError('OSM request body must be an object');
  }
  const unknown = Object.keys(body).filter((key) => key !== 'URL');
  if (unknown.length > 0) {
    throw new OsmCityUpdateValidationError(
      `OSM request body contains unsupported properties: ${unknown.join(', ')}`,
    );
  }
  if (typeof body.URL !== 'string' || !body.URL.trim()) {
    throw new OsmCityUpdateValidationError('OSM request body.URL must be a string');
  }
  const normalized = normalizeOsmUpdateUrl(body.URL.trim(), allowedHosts);
  if (allowedURLs && !allowedURLs.has(normalized)) {
    throw new OsmCityUpdateValidationError(
      `OSM URL is not in the allowed URL list: ${normalized}`,
    );
  }
  return normalized;
}

/** @param {unknown} value @param {string} name */
function queryValue(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new OsmCityUpdateValidationError(`${name} must be specified once`);
  }
  return value;
}

/** @param {unknown} value @param {string} name @param {boolean} fallback */
function queryBoolean(value, name, fallback) {
  const raw = queryValue(value, name);
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new OsmCityUpdateValidationError(`${name} must equal true or false`);
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} maximum
 * @param {number} [fallback]
 */
function boundedQueryInteger(value, name, maximum, fallback = maximum) {
  const raw = queryValue(value, name);
  if (raw === undefined) return fallback;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new OsmCityUpdateValidationError(
      `${name} must be an integer between 1 and ${maximum}`,
    );
  }
  return number;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} minimum
 * @param {number} maximum
 * @param {number} fallback
 */
function rangedQueryInteger(value, name, minimum, maximum, fallback) {
  const raw = queryValue(value, name);
  if (raw === undefined) return fallback;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new OsmCityUpdateValidationError(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return number;
}

/**
 * Resolve request overrides without allowing a request to raise ENV limits.
 * @param {unknown} body
 * @param {Record<string, unknown>} query
 * @param {any} config
 */
export function resolveOsmCityUpdateRequest(body, query, config) {
  const retryMaxDelayMs = rangedQueryInteger(
    query.retryMaxDelayMs,
    'retryMaxDelayMs',
    config.retryMaxDelayMs,
    3600000,
    config.retryMaxDelayMs,
  );
  const retryBaseDelayMs = rangedQueryInteger(
    query.retryBaseDelayMs,
    'retryBaseDelayMs',
    config.retryBaseDelayMs,
    retryMaxDelayMs,
    config.retryBaseDelayMs,
  );
  return {
    url: resolveUrl(
      body,
      config.allowedHosts,
      config.allowedURLs,
      config.url,
    ),
    dryRun: queryBoolean(query.dryRun, 'dryRun', config.dryRun),
    timeoutMs: boundedQueryInteger(
      query.timeoutMs,
      'timeoutMs',
      config.timeoutMs,
    ),
    queryTimeoutSeconds: boundedQueryInteger(
      query.queryTimeoutSeconds,
      'queryTimeoutSeconds',
      config.queryTimeoutSeconds,
    ),
    maxBytes: boundedQueryInteger(query.maxBytes, 'maxBytes', config.maxBytes),
    batchSize: boundedQueryInteger(
      query.batchSize,
      'batchSize',
      config.maxBatchSize,
      config.batchSize,
    ),
    minDelayMs: rangedQueryInteger(
      query.minDelayMs,
      'minDelayMs',
      config.minDelayMs,
      300000,
      config.minDelayMs,
    ),
    maxRetries: rangedQueryInteger(
      query.maxRetries,
      'maxRetries',
      0,
      config.maxRetries,
      config.maxRetries,
    ),
    retryBaseDelayMs,
    retryMaxDelayMs,
  };
}
