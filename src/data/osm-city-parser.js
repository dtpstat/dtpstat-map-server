import { OsmCityUpdateValidationError } from './osm-city-update-options.js';

/** @param {number} timeoutSeconds */
export function buildRussianPlaceIdOverpassQueries(timeoutSeconds) {
  return ['city', 'town'].flatMap((placeType) =>
    ['way', 'relation'].map((osmType) => ({
      placeType,
      osmType,
      query: `[out:json][timeout:${timeoutSeconds}];
area["ISO3166-1"="RU"]["boundary"="administrative"]["admin_level"="2"]->.ru;
${osmType}(area.ru)["place"="${placeType}"]["name"];
out ids;`,
    })),
  );
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
        'OSM ID response contains an invalid place object',
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
        'OSM place geometry contains coordinates outside WGS84',
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

/** @param {string} jsonText */
export function parseOsmCityResponse(jsonText) {
  const document = parseDocument(jsonText);

  const objectKeys = new Set();
  const nameCounts = new Map();
  const places = [];
  let ignoredElements = 0;
  for (const element of document.elements) {
    const name = typeof element?.tags?.name === 'string'
      ? element.tags.name.trim().normalize('NFC')
      : '';
    if (
      (element?.type !== 'way' && element?.type !== 'relation') ||
      (element?.tags?.place !== 'city' && element?.tags?.place !== 'town') ||
      !name
    ) {
      ignoredElements += 1;
      continue;
    }
    if (!Number.isSafeInteger(element.id) || element.id <= 0) {
      throw new OsmCityUpdateValidationError(`OSM place ${name} has an invalid id`);
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
        `OSM place ${name} has no way geometry`,
      );
    }
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    places.push({
      name,
      placeType: element.tags.place,
      osmType: element.type,
      osmId: element.id,
      tags: element.tags,
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
      'OSM response contains no named Russian place=city/town ways or relations',
    );
  }

  return {
    places,
    sourceElements: document.elements.length,
    ignoredElements,
    cityPlaces: places.filter((place) => place.placeType === 'city').length,
    townPlaces: places.filter((place) => place.placeType === 'town').length,
    duplicateNames: [...nameCounts.values()].filter((count) => count > 1).length,
    osmTimestamp: osmTimestamp(document),
  };
}
