import {
  DEFAULT_LINE_TYPE_NAME,
  LineTypeValidationError,
  normalizeLineTypeName,
} from './type-policy.js';

export class KmlUpdateValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KmlUpdateValidationError';
  }
}

/** @param {unknown} value */
function plainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

/** @param {Record<string, unknown>} value @param {string[]} allowed @param {string} label */
function rejectUnknownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new KmlUpdateValidationError(
      `${label} contains unsupported properties: ${unknown.join(', ')}`,
    );
  }
}

/** @param {unknown} value @param {string} label */
function normalizeKmlLineTypeName(value, label) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_LINE_TYPE_NAME;
  }
  try {
    return normalizeLineTypeName(value, label);
  } catch (error) {
    if (error instanceof LineTypeValidationError) {
      throw new KmlUpdateValidationError(error.message);
    }
    throw error;
  }
}

/** @param {string} rawUrl @param {Set<string>} allowedHosts */
export function normalizeKmlUrl(rawUrl, allowedHosts) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new KmlUpdateValidationError(`Invalid KML URL: ${rawUrl}`);
  }

  if (url.protocol !== 'https:') {
    throw new KmlUpdateValidationError('KML URLs must use HTTPS');
  }
  if (url.username || url.password) {
    throw new KmlUpdateValidationError('KML URLs must not contain credentials');
  }
  const host = url.hostname.toLocaleLowerCase('en-US');
  if (!allowedHosts.has(host)) {
    throw new KmlUpdateValidationError(`KML host is not allowed: ${host}`);
  }

  const googleViewer = /(^|\.)google\.com$/i.test(host) &&
    /^\/maps\/d\/(?:u\/\d+\/)?(?:viewer|kml)\/?$/i.test(url.pathname);
  let mapId = null;
  let fetchUrl = url;
  if (googleViewer) {
    mapId = url.searchParams.get('mid');
    if (!mapId || !/^[A-Za-z0-9_-]+$/.test(mapId)) {
      throw new KmlUpdateValidationError('Google My Maps URL has an invalid mid');
    }
    fetchUrl = new URL('https://www.google.com/maps/d/kml');
    fetchUrl.searchParams.set('mid', mapId);
    fetchUrl.searchParams.set('forcekml', '1');
    if (!allowedHosts.has(fetchUrl.hostname)) {
      throw new KmlUpdateValidationError(
        `KML host is not allowed: ${fetchUrl.hostname}`,
      );
    }
  }

  url.hash = '';
  fetchUrl.hash = '';
  return {
    URL: url.toString(),
    fetchURL: fetchUrl.toString(),
    mapId,
  };
}

/**
 * @param {unknown} value
 * @param {{ maxSources: number, allowedHosts: Set<string> }} constraints
 */
export function validateKmlSources(value, constraints) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new KmlUpdateValidationError(
      'KML sources must be a non-empty JSON array',
    );
  }
  if (value.length > constraints.maxSources) {
    throw new KmlUpdateValidationError(
      `KML sources exceed the configured limit of ${constraints.maxSources}`,
    );
  }

  const seenUrls = new Set();
  return value.map((rawSource, sourceIndex) => {
    const label = `KML source ${sourceIndex}`;
    if (!plainObject(rawSource)) {
      throw new KmlUpdateValidationError(`${label} must be an object`);
    }
    rejectUnknownKeys(rawSource, ['URL', 'layers'], label);
    if (typeof rawSource.URL !== 'string' || !rawSource.URL.trim()) {
      throw new KmlUpdateValidationError(`${label}.URL must be a string`);
    }
    const normalizedUrl = normalizeKmlUrl(
      rawSource.URL.trim(),
      constraints.allowedHosts,
    );
    if (seenUrls.has(normalizedUrl.fetchURL)) {
      throw new KmlUpdateValidationError(`${label}.URL is duplicated`);
    }
    seenUrls.add(normalizedUrl.fetchURL);

    if (!Array.isArray(rawSource.layers) || rawSource.layers.length === 0) {
      throw new KmlUpdateValidationError(
        `${label}.layers must be a non-empty array`,
      );
    }
    const seenLayers = new Set();
    const layers = rawSource.layers.map((rawLayer, layerIndex) => {
      const layerLabel = `${label}.layers[${layerIndex}]`;
      if (!plainObject(rawLayer)) {
        throw new KmlUpdateValidationError(`${layerLabel} must be an object`);
      }
      rejectUnknownKeys(rawLayer, ['name', 'multiple', 'type'], layerLabel);
      if (typeof rawLayer.name !== 'string' || !rawLayer.name.trim()) {
        throw new KmlUpdateValidationError(`${layerLabel}.name must be a string`);
      }
      const name = rawLayer.name.trim().normalize('NFC');
      if (seenLayers.has(name)) {
        throw new KmlUpdateValidationError(`${layerLabel}.name is duplicated`);
      }
      seenLayers.add(name);
      if (rawLayer.multiple !== 1 && rawLayer.multiple !== 2) {
        throw new KmlUpdateValidationError(
          `${layerLabel}.multiple must equal 1 or 2`,
        );
      }
      return {
        name,
        multiple: rawLayer.multiple,
        type: normalizeKmlLineTypeName(rawLayer.type, `${layerLabel}.type`),
      };
    });

    return { ...normalizedUrl, layers };
  });
}

/**
 * @param {string | undefined} raw
 * @param {{ maxSources: number, allowedHosts: Set<string> }} constraints
 */
export function parseKmlSourcesJson(raw, constraints) {
  if (raw === undefined || raw.trim() === '') return [];
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new KmlUpdateValidationError(
      'KML_UPDATE_SOURCES_JSON must contain valid JSON',
    );
  }
  return validateKmlSources(value, constraints);
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
  throw new KmlUpdateValidationError(
    `${name} must be boolean`,
  );
}

/** @param {unknown} value @param {string} name @param {number} maximum @param {number} fallback */
function boundedInteger(
  value,
  name,
  maximum,
  fallback,
) {
  if (value === undefined) {
    return fallback;
  }
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new KmlUpdateValidationError(
      `${name} must be an integer between 1 and ${maximum}`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} name @param {number} maximum @param {number} fallback */
function boundedNonNegativeInteger(
  value,
  name,
  maximum,
  fallback,
) {
  if (value === undefined) {
    return fallback;
  }
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new KmlUpdateValidationError(
      `${name} must be an integer between 0 and ${maximum}`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} name @param {string[]} allowed @param {string} fallback */
function optionEnum(
  value,
  name,
  allowed,
  fallback,
) {
  if (value === undefined) {
    return fallback;
  }
  if (
    typeof value !== 'string' ||
    !allowed.includes(value)
  ) {
    throw new KmlUpdateValidationError(
      `${name} must be one of: ${allowed.join(', ')}`,
    );
  }
  return value;
}

/**
 * @param {unknown} body
 * @param {Record<string, unknown>} _query
 * @param {any} config
 */
export function resolveKmlUpdateRequest(
  body,
  _query,
  config,
) {
  const options =
    body === undefined
      ? {}
      : body;

  if (
    !plainObject(options)
  ) {
    throw new KmlUpdateValidationError(
      'KML update body must be a JSON object',
    );
  }

  const allowed = [
    'sources',
    'dryRun',
    'timeoutMs',
    'maxFileBytes',
    'maxTotalBytes',
    'cityBufferMeters',
    'unmatchedPolicy',
    'ambiguousPolicy',
  ];

  rejectUnknownKeys(
    options,
    allowed,
    'KML update body',
  );

  const sources =
    options.sources === undefined
      ? config.sources
      : validateKmlSources(
          options.sources,
          config,
        );

  if (sources.length === 0) {
    throw new KmlUpdateValidationError(
      'No KML sources supplied in the request or KML_UPDATE_SOURCES_JSON',
    );
  }

  return {
    sources,
    dryRun:
      optionBoolean(
        options.dryRun,
        'dryRun',
        config.dryRun,
      ),
    timeoutMs:
      boundedInteger(
        options.timeoutMs,
        'timeoutMs',
        config.timeoutMs,
        config.timeoutMs,
      ),
    maxFileBytes:
      boundedInteger(
        options.maxFileBytes,
        'maxFileBytes',
        config.maxFileBytes,
        config.maxFileBytes,
      ),
    maxTotalBytes:
      boundedInteger(
        options.maxTotalBytes,
        'maxTotalBytes',
        config.maxTotalBytes,
        config.maxTotalBytes,
      ),
    cityBufferMeters:
      boundedNonNegativeInteger(
        options.cityBufferMeters,
        'cityBufferMeters',
        config.cityBufferMaxMeters,
        config.cityBufferMeters,
      ),
    unmatchedPolicy:
      optionEnum(
        options.unmatchedPolicy,
        'unmatchedPolicy',
        [
          'skip',
          'fail',
        ],
        config.unmatchedPolicy,
      ),
    ambiguousPolicy:
      optionEnum(
        options.ambiguousPolicy,
        'ambiguousPolicy',
        [
          'best-overlap',
          'fail',
        ],
        config.ambiguousPolicy,
      ),
  };
}
