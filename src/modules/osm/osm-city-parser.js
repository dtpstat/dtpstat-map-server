import { OsmCityUpdateValidationError } from './osm-city-update-options.js';

function adminLevelPattern(minimum, maximum) {
  const levels = [];
  for (let level = minimum; level <= maximum; level += 1) levels.push(level);
  return `^(${levels.join('|')})$`;
}

/**
 * Build a small ID-only index first. Geometry is still fetched later in
 * sequential batches. One OSM object may match both a place selector and an
 * administrative selector; the update service deduplicates by type/id.
 *
 * @param {number} timeoutSeconds
 * @param {{
 *   includeCity?: boolean,
 *   includeTown?: boolean,
 *   includeAdministrative?: boolean,
 *   adminLevelMin?: number,
 *   adminLevelMax?: number
 * }} [options]
 */
export function buildRussianPlaceIdOverpassQueries(timeoutSeconds, options = {}) {
  const includeCity = options.includeCity ?? true;
  const includeTown = options.includeTown ?? true;
  const includeAdministrative = options.includeAdministrative ?? false;
  const adminLevelMin = options.adminLevelMin ?? 4;
  const adminLevelMax = options.adminLevelMax ?? 8;
  const queries = [];
  const placeTypes = [
    ...(includeCity ? ['city'] : []),
    ...(includeTown ? ['town'] : []),
  ];

  for (const placeType of placeTypes) {
    for (const osmType of ['way', 'relation']) {
      queries.push({
        kind: 'place',
        placeType,
        osmType,
        query: `[out:json][timeout:${timeoutSeconds}];
area["ISO3166-1"="RU"]["boundary"="administrative"]["admin_level"="2"]->.ru;
${osmType}(area.ru)["place"="${placeType}"]["name"];
out ids;`,
      });
    }
  }

  if (includeAdministrative) {
    const levels = adminLevelPattern(adminLevelMin, adminLevelMax);
    for (const osmType of ['way', 'relation']) {
      queries.push({
        kind: 'administrative',
        placeType: null,
        osmType,
        query: `[out:json][timeout:${timeoutSeconds}];
area["ISO3166-1"="RU"]["boundary"="administrative"]["admin_level"="2"]->.ru;
${osmType}(area.ru)["boundary"="administrative"]["admin_level"~"${levels}"]["name"];
out ids;`,
      });
    }
  }

  if (queries.length === 0) {
    throw new OsmCityUpdateValidationError(
      'At least one OSM object class must be enabled',
    );
  }
  return queries;
}

/**
 * @param {{ osmType: 'way' | 'relation', osmId: number }[]} objects
 * @param {number} timeoutSeconds
 */
export function buildOsmPlacesBatchQuery(objects, timeoutSeconds) {
  if (!Array.isArray(objects) || objects.length === 0) {
    throw new OsmCityUpdateValidationError(
      'OSM geometry batch must contain at least one object',
    );
  }
  const ids = { way: [], relation: [] };
  for (const object of objects) {
    if (
      (object?.osmType !== 'way' && object?.osmType !== 'relation') ||
      !Number.isSafeInteger(object?.osmId) ||
      object.osmId <= 0
    ) {
      throw new OsmCityUpdateValidationError(
        'OSM geometry batch contains an invalid object ID',
      );
    }
    ids[object.osmType].push(object.osmId);
  }

  const selectors = [];
  if (ids.way.length > 0) selectors.push(`  way(id:${ids.way.join(',')});`);
  if (ids.relation.length > 0) {
    selectors.push(`  relation(id:${ids.relation.join(',')});`);
  }
  return `[out:json][timeout:${timeoutSeconds}];
(
${selectors.join('\n')}
);
out body geom;`;
}

/** @param {unknown} document */
function validateDocument(document) {
  if (!document || typeof document !== 'object' || !Array.isArray(document.elements)) {
    throw new OsmCityUpdateValidationError(
      'OSM response must contain an elements array',
    );
  }
  if (typeof document.remark === 'string' && document.remark.trim()) {
    throw new OsmCityUpdateValidationError(
      `Overpass returned an error: ${document.remark.trim()}`,
    );
  }
}

/** @param {any} document */
function osmTimestamp(document) {
  const timestamp = document.osm3s?.timestamp_osm_base;
  return typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp))
    ? new Date(timestamp).toISOString()
    : null;
}

/** @param {string} jsonText */
function parseDocument(jsonText) {
  let document;
  try {
    document = JSON.parse(jsonText);
  } catch {
    throw new OsmCityUpdateValidationError('OSM response is not valid JSON');
  }
  validateDocument(document);
  return document;
}

/** @param {string} jsonText */
export function parseOsmPlaceIdsResponse(jsonText) {
  const document = parseDocument(jsonText);
  const objectKeys = new Set();
  const objects = document.elements.map((element) => {
    if (
      (element?.type !== 'way' && element?.type !== 'relation') ||
      !Number.isSafeInteger(element.id) ||
      element.id <= 0
    ) {
      throw new OsmCityUpdateValidationError(
        'OSM ID response contains an invalid boundary object',
      );
    }
    const objectKey = `${element.type}/${element.id}`;
    if (objectKeys.has(objectKey)) {
      throw new OsmCityUpdateValidationError(
        `OSM ID response contains duplicate object ${objectKey}`,
      );
    }
    objectKeys.add(objectKey);
    return { osmType: element.type, osmId: element.id };
  });
  objects.sort((left, right) =>
    left.osmType.localeCompare(right.osmType) || left.osmId - right.osmId);
  return {
    objects,
    sourceElements: document.elements.length,
    osmTimestamp: osmTimestamp(document),
  };
}

/** @param {unknown} value */
function coordinates(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const result = [];
  for (const point of value) {
    const longitude = Number(point?.lon);
    const latitude = Number(point?.lat);
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      throw new OsmCityUpdateValidationError(
        'OSM boundary geometry contains coordinates outside WGS84',
      );
    }
    result.push([longitude, latitude]);
  }
  return result;
}

/** @param {any} element */
function linework(element) {
  if (element.type === 'way') {
    const line = coordinates(element.geometry);
    return line ? [line] : [];
  }
  if (element.type !== 'relation' || !Array.isArray(element.members)) return [];
  return element.members
    .filter((member) => member?.type === 'way')
    .map((member) => coordinates(member.geometry))
    .filter((line) => line !== null);
}

function parsedAdminLevel(tags) {
  if (tags?.boundary !== 'administrative') return null;
  const raw = tags.admin_level;
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) return null;
  const level = Number(raw);
  return Number.isSafeInteger(level) && level > 0 && level <= 20 ? level : null;
}

/** @param {string} jsonText */
export function parseOsmCityResponse(jsonText) {
  const document = parseDocument(jsonText);

  const objectKeys = new Set();
  const nameCounts = new Map();
  const places = [];
  let ignoredElements = 0;
  for (const element of document.elements) {
    const tags = element?.tags ?? {};
    const name = typeof tags.name === 'string'
      ? tags.name.trim().normalize('NFC')
      : '';
    const placeType = tags.place === 'city' || tags.place === 'town'
      ? tags.place
      : null;
    const adminLevel = parsedAdminLevel(tags);
    if (
      (element?.type !== 'way' && element?.type !== 'relation') ||
      (!placeType && adminLevel === null) ||
      !name
    ) {
      ignoredElements += 1;
      continue;
    }
    if (!Number.isSafeInteger(element.id) || element.id <= 0) {
      throw new OsmCityUpdateValidationError(
        `OSM boundary ${name} has an invalid id`,
      );
    }
    const objectKey = `${element.type}/${element.id}`;
    if (objectKeys.has(objectKey)) {
      throw new OsmCityUpdateValidationError(
        `OSM response contains duplicate object ${objectKey}`,
      );
    }
    objectKeys.add(objectKey);
    const lines = linework(element);
    if (lines.length === 0) {
      throw new OsmCityUpdateValidationError(
        `OSM boundary ${name} has no way geometry`,
      );
    }
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    places.push({
      name,
      placeType,
      adminLevel,
      osmType: element.type,
      osmId: element.id,
      tags,
      linework: {
        type: 'MultiLineString',
        coordinates: lines,
      },
    });
  }

  places.sort((left, right) =>
    left.name.localeCompare(right.name, 'ru-RU') ||
    left.osmType.localeCompare(right.osmType) ||
    left.osmId - right.osmId);
  if (places.length === 0) {
    throw new OsmCityUpdateValidationError(
      'OSM response contains no indexed named place/admin boundary objects',
    );
  }

  return {
    places,
    sourceElements: document.elements.length,
    ignoredElements,
    cityPlaces: places.filter((place) => place.placeType === 'city').length,
    townPlaces: places.filter((place) => place.placeType === 'town').length,
    administrativePlaces: places.filter((place) => place.adminLevel !== null).length,
    duplicateNames: [...nameCounts.values()].filter((count) => count > 1).length,
    osmTimestamp: osmTimestamp(document),
  };
}
