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

/** @param {unknown} value @param {string} name @param {boolean} fallback */
function optionBoolean(
  value,
  name,
  fallback,
) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  throw new OsmCityUpdateValidationError(
    `${name} must be boolean`,
  );
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} minimum
 * @param {number} maximum
 * @param {number} fallback
 */
function rangedInteger(
  value,
  name,
  minimum,
  maximum,
  fallback,
) {
  if (value === undefined) {
    return fallback;
  }
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new OsmCityUpdateValidationError(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

/**
 * @param {Record<string, unknown>} options
 * @param {any} config
 */
function resolveUrl(
  options,
  config,
) {
  if (
    options.URL === undefined
  ) {
    return config.url;
  }

  if (
    typeof options.URL !== 'string' ||
    !options.URL.trim()
  ) {
    throw new OsmCityUpdateValidationError(
      'URL must be a non-empty string',
    );
  }

  const normalized =
    normalizeOsmUpdateUrl(
      options.URL.trim(),
      config.allowedHosts,
    );

  if (
    config.allowedURLs &&
    !config.allowedURLs.has(
      normalized,
    )
  ) {
    throw new OsmCityUpdateValidationError(
      `OSM URL is not in the allowed URL list: ${normalized}`,
    );
  }

  return normalized;
}

/**
 * Resolve request overrides without allowing a request to raise deployment
 * limits. Mutating API options live only in the JSON body.
 *
 * @param {unknown} body
 * @param {Record<string, unknown>} _query
 * @param {any} config
 */
export function resolveOsmCityUpdateRequest(
  body,
  _query,
  config,
) {
  const options =
    body === undefined
      ? {}
      : body;

  if (!plainObject(options)) {
    throw new OsmCityUpdateValidationError(
      'OSM update body must be a JSON object',
    );
  }

  const allowed =
    new Set([
      'URL',
      'dryRun',
      'resume',
      'restart',
      'includeCity',
      'includeTown',
      'includeAdministrative',
      'adminLevelMin',
      'adminLevelMax',
      'timeoutMs',
      'queryTimeoutSeconds',
      'maxResponseBytes',
      'maxTotalBytes',
      'batchSize',
      'minDelayMs',
      'maxRetries',
      'retryBaseDelayMs',
      'retryMaxDelayMs',
    ]);

  const unknown =
    Object.keys(options)
      .filter(
        (key) =>
          !allowed.has(key),
      );

  if (unknown.length > 0) {
    throw new OsmCityUpdateValidationError(
      'OSM update body contains unsupported properties: ' +
      unknown.join(', '),
    );
  }

  const includeCity =
    optionBoolean(
      options.includeCity,
      'includeCity',
      config.includeCity ??
      true,
    );
  const includeTown =
    optionBoolean(
      options.includeTown,
      'includeTown',
      config.includeTown ??
      true,
    );
  const includeAdministrative =
    optionBoolean(
      options.includeAdministrative,
      'includeAdministrative',
      config.includeAdministrative ??
      false,
    );

  const adminLevelMin =
    rangedInteger(
      options.adminLevelMin,
      'adminLevelMin',
      1,
      20,
      config.adminLevelMin ??
      4,
    );
  const adminLevelMax =
    rangedInteger(
      options.adminLevelMax,
      'adminLevelMax',
      1,
      20,
      config.adminLevelMax ??
      8,
    );

  if (
    !includeCity &&
    !includeTown &&
    !includeAdministrative
  ) {
    throw new OsmCityUpdateValidationError(
      'At least one OSM object class must be enabled',
    );
  }

  if (
    adminLevelMin >
    adminLevelMax
  ) {
    throw new OsmCityUpdateValidationError(
      'adminLevelMin must not exceed adminLevelMax',
    );
  }

  const maxResponseBytesLimit =
    config.maxResponseBytes ??
    Math.min(
      config.maxBytes,
      128 * 1024 * 1024,
    );
  const maxTotalBytesLimit =
    config.maxTotalBytes ??
    config.maxBytes;

  const maxResponseBytes =
    rangedInteger(
      options.maxResponseBytes,
      'maxResponseBytes',
      1,
      maxResponseBytesLimit,
      maxResponseBytesLimit,
    );
  const maxTotalBytes =
    rangedInteger(
      options.maxTotalBytes,
      'maxTotalBytes',
      1,
      maxTotalBytesLimit,
      maxTotalBytesLimit,
    );

  if (
    maxResponseBytes >
    maxTotalBytes
  ) {
    throw new OsmCityUpdateValidationError(
      'maxResponseBytes must not exceed maxTotalBytes',
    );
  }

  const retryMaxDelayMs =
    rangedInteger(
      options.retryMaxDelayMs,
      'retryMaxDelayMs',
      config.retryMaxDelayMs,
      3600000,
      config.retryMaxDelayMs,
    );
  const retryBaseDelayMs =
    rangedInteger(
      options.retryBaseDelayMs,
      'retryBaseDelayMs',
      config.retryBaseDelayMs,
      retryMaxDelayMs,
      config.retryBaseDelayMs,
    );

  const resume =
    optionBoolean(
      options.resume,
      'resume',
      false,
    );
  const restart =
    optionBoolean(
      options.restart,
      'restart',
      false,
    );

  if (
    resume &&
    restart
  ) {
    throw new OsmCityUpdateValidationError(
      'resume and restart cannot both be true',
    );
  }

  return {
    url:
      resolveUrl(
        options,
        config,
      ),
    dryRun:
      optionBoolean(
        options.dryRun,
        'dryRun',
        config.dryRun,
      ),
    resume,
    restart,
    includeCity,
    includeTown,
    includeAdministrative,
    adminLevelMin,
    adminLevelMax,
    timeoutMs:
      rangedInteger(
        options.timeoutMs,
        'timeoutMs',
        1,
        config.timeoutMs,
        config.timeoutMs,
      ),
    queryTimeoutSeconds:
      rangedInteger(
        options.queryTimeoutSeconds,
        'queryTimeoutSeconds',
        1,
        config.queryTimeoutSeconds,
        config.queryTimeoutSeconds,
      ),
    maxResponseBytes,
    maxTotalBytes,
    maxBytes:
      maxTotalBytes,
    batchSize:
      rangedInteger(
        options.batchSize,
        'batchSize',
        1,
        config.maxBatchSize,
        config.batchSize,
      ),
    minDelayMs:
      rangedInteger(
        options.minDelayMs,
        'minDelayMs',
        config.minDelayMs,
        300000,
        config.minDelayMs,
      ),
    maxRetries:
      rangedInteger(
        options.maxRetries,
        'maxRetries',
        0,
        config.maxRetries,
        config.maxRetries,
      ),
    retryBaseDelayMs,
    retryMaxDelayMs,
  };
}
