import {
  LineTypeValidationError,
  normalizeLineTypeCode,
} from './line-types.js';

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
function normalizeKmlLineType(value, label) {
  try {
    return normalizeLineTypeCode(value, label);
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
        type: normalizeKmlLineType(rawLayer.type, `${layerLabel}.type`),
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

/** @param {unknown} value @param {string} name */
function queryValue(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new KmlUpdateValidationError(`${name} must be specified once`);
  }
  return value;
}

/** @param {unknown} value @param {string} name @param {boolean} fallback */
function queryBoolean(value, name, fallback) {
  const raw = queryValue(value, name);
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new KmlUpdateValidationError(`${name} must equal true or false`);
}

/** @param {unknown} value @param {string} name @param {number} maximum */
function boundedQueryInteger(value, name, maximum) {
  const raw = queryValue(value, name);
  if (raw === undefined) return maximum;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new KmlUpdateValidationError(
      `${name} must be an integer between 1 and ${maximum}`,
    );
  }
  return number;
}

/** @param {unknown} value @param {string} name @param {number} maximum @param {number} fallback */
function boundedQueryNonNegativeInteger(value, name, maximum, fallback) {
  const raw = queryValue(value, name);
  if (raw === undefined) return fallback;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 0 || number > maximum) {
    throw new KmlUpdateValidationError(
      `${name} must be an integer between 0 and ${maximum}`,
    );
  }
  return number;
}

/** @param {unknown} value @param {string} name @param {string[]} allowed @param {string} fallback */
function queryEnum(value, name, allowed, fallback) {
  const raw = queryValue(value, name);
  if (raw === undefined) return fallback;
  if (!allowed.includes(raw)) {
    throw new KmlUpdateValidationError(
      `${name} must be one of: ${allowed.join(', ')}`,
    );
  }
  return raw;
}

/**
 * @param {unknown} body
 * @param {Record<string, unknown>} query
 * @param {any} config
 */
export function resolveKmlUpdateRequest(body, query, config) {
  const sources = body === undefined
    ? config.sources
    : validateKmlSources(body, config);
  if (sources.length === 0) {
    throw new KmlUpdateValidationError(
      'No KML sources supplied in the request or KML_UPDATE_SOURCES_JSON',
    );
  }

  return {
    sources,
    dryRun: queryBoolean(query.dryRun, 'dryRun', config.dryRun),
    timeoutMs: boundedQueryInteger(
      query.timeoutMs,
      'timeoutMs',
      config.timeoutMs,
    ),
    maxFileBytes: boundedQueryInteger(
      query.maxFileBytes,
      'maxFileBytes',
      config.maxFileBytes,
    ),
    maxTotalBytes: boundedQueryInteger(
      query.maxTotalBytes,
      'maxTotalBytes',
      config.maxTotalBytes,
    ),
    cityBufferMeters: boundedQueryNonNegativeInteger(
      query.cityBufferMeters,
      'cityBufferMeters',
      config.cityBufferMaxMeters,
      config.cityBufferMeters,
    ),
    unmatchedPolicy: queryEnum(
      query.unmatchedPolicy,
      'unmatchedPolicy',
      ['skip', 'fail'],
      config.unmatchedPolicy,
    ),
    ambiguousPolicy: queryEnum(
      query.ambiguousPolicy,
      'ambiguousPolicy',
      ['best-overlap', 'fail'],
      config.ambiguousPolicy,
    ),
  };
}
