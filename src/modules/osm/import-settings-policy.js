import {
  normalizeOsmUpdateUrl,
  OsmCityUpdateValidationError,
} from '../../data/osm-city-update-options.js';

function object(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function bool(value, name) {
  if (typeof value !== 'boolean') {
    throw new OsmCityUpdateValidationError(
      `${name} must be boolean`,
    );
  }

  return value;
}

function integer(
  value,
  name,
  min,
  max,
) {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < min ||
    number > max
  ) {
    throw new OsmCityUpdateValidationError(
      `${name} must be an integer between ${min} and ${max}`,
    );
  }

  return number;
}

/**
 * Normalize the editable OSM import settings accepted from the admin UI.
 *
 * @param {unknown} value
 * @param {{
 *   allowedHosts: Set<string>,
 *   allowedURLs: Set<string>,
 *   maxBatchSize: number
 * }} config
 */
export function normalizeOsmImportSettingsPayload(
  value,
  config,
) {
  if (!object(value)) {
    throw new OsmCityUpdateValidationError(
      'OSM settings body must be an object',
    );
  }

  const allowed = new Set([
    'sourceURL',
    'includeCity',
    'includeTown',
    'includeAdministrative',
    'adminLevelMin',
    'adminLevelMax',
    'batchSize',
    'minDelayMs',
    'timeoutMs',
    'queryTimeoutSeconds',
    'maxResponseBytes',
    'maxTotalBytes',
    'maxRetries',
    'retryBaseDelayMs',
    'retryMaxDelayMs',
  ]);

  const unknown =
    Object.keys(value)
      .filter(
        (key) =>
          !allowed.has(key),
      );

  if (unknown.length > 0) {
    throw new OsmCityUpdateValidationError(
      'OSM settings contain unsupported properties: ' +
      unknown.join(', '),
    );
  }

  const sourceURL =
    normalizeOsmUpdateUrl(
      String(value.sourceURL ?? ''),
      config.allowedHosts,
    );

  if (
    !config.allowedURLs.has(
      sourceURL,
    )
  ) {
    throw new OsmCityUpdateValidationError(
      'OSM URL is not in the allowed URL list: ' +
      sourceURL,
    );
  }

  const result = {
    sourceURL,
    includeCity:
      bool(
        value.includeCity,
        'includeCity',
      ),
    includeTown:
      bool(
        value.includeTown,
        'includeTown',
      ),
    includeAdministrative:
      bool(
        value.includeAdministrative,
        'includeAdministrative',
      ),
    adminLevelMin:
      integer(
        value.adminLevelMin,
        'adminLevelMin',
        1,
        20,
      ),
    adminLevelMax:
      integer(
        value.adminLevelMax,
        'adminLevelMax',
        1,
        20,
      ),
    batchSize:
      integer(
        value.batchSize,
        'batchSize',
        1,
        config.maxBatchSize,
      ),
    minDelayMs:
      integer(
        value.minDelayMs,
        'minDelayMs',
        0,
        300000,
      ),
    timeoutMs:
      integer(
        value.timeoutMs,
        'timeoutMs',
        1000,
        900000,
      ),
    queryTimeoutSeconds:
      integer(
        value.queryTimeoutSeconds,
        'queryTimeoutSeconds',
        1,
        600,
      ),
    maxResponseBytes:
      integer(
        value.maxResponseBytes,
        'maxResponseBytes',
        1024 * 1024,
        512 * 1024 * 1024,
      ),
    maxTotalBytes:
      integer(
        value.maxTotalBytes,
        'maxTotalBytes',
        1024 * 1024,
        8 * 1024 * 1024 * 1024,
      ),
    maxRetries:
      integer(
        value.maxRetries,
        'maxRetries',
        0,
        20,
      ),
    retryBaseDelayMs:
      integer(
        value.retryBaseDelayMs,
        'retryBaseDelayMs',
        1000,
        3600000,
      ),
    retryMaxDelayMs:
      integer(
        value.retryMaxDelayMs,
        'retryMaxDelayMs',
        1000,
        3600000,
      ),
  };

  if (
    !result.includeCity &&
    !result.includeTown &&
    !result.includeAdministrative
  ) {
    throw new OsmCityUpdateValidationError(
      'At least one OSM object class must be enabled',
    );
  }

  if (
    result.adminLevelMin >
    result.adminLevelMax
  ) {
    throw new OsmCityUpdateValidationError(
      'adminLevelMin must not exceed adminLevelMax',
    );
  }

  if (
    result.retryBaseDelayMs >
    result.retryMaxDelayMs
  ) {
    throw new OsmCityUpdateValidationError(
      'retryBaseDelayMs must not exceed retryMaxDelayMs',
    );
  }

  if (
    result.maxResponseBytes >
    result.maxTotalBytes
  ) {
    throw new OsmCityUpdateValidationError(
      'maxResponseBytes must not exceed maxTotalBytes',
    );
  }

  return result;
}
