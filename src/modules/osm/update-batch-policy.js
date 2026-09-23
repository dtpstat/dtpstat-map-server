import { OsmCityUpdateValidationError } from '../../data/osm-city-update-options.js';
import { OsmCityGeometryError } from './update-errors.js';

/** @param {{ osmType: string, osmId: number | string }} object */
export function objectKey(object) {
  return `${object.osmType}/${object.osmId}`;
}

/**
 * @param {any[]} expected
 * @param {any[]} places
 * @param {number} batchNumber
 */
export function assertCompleteBatch(expected, places, batchNumber) {
  const expectedKeys = new Set(expected.map(objectKey));
  const actualKeys = new Set(places.map(objectKey));
  const missing = [...expectedKeys].filter((key) => !actualKeys.has(key));
  const unexpected = [...actualKeys].filter((key) => !expectedKeys.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [];
    if (missing.length > 0) details.push(`missing: ${missing.join(', ')}`);
    if (unexpected.length > 0) {
      details.push(`unexpected: ${unexpected.join(', ')}`);
    }
    throw new OsmCityGeometryError(
      `OSM geometry batch ${batchNumber} does not match its ID index (${details.join('; ')})`,
    );
  }
}

/** @param {Map<string, number>} counts @param {any[]} places */
export function addNameCounts(counts, places) {
  for (const place of places) {
    counts.set(place.name, (counts.get(place.name) ?? 0) + 1);
  }
}

/** @param {any[]} parts */
export function combineIndexParts(parts) {
  const keys = new Set();
  const objects = [];
  const timestamps = [];
  let sourceElements = 0;
  let duplicateIndexObjects = 0;

  for (const part of parts) {
    sourceElements += part.sourceElements;
    if (part.osmTimestamp) timestamps.push(Date.parse(part.osmTimestamp));
    for (const object of part.objects) {
      const key = objectKey(object);
      if (keys.has(key)) {
        duplicateIndexObjects += 1;
        continue;
      }
      keys.add(key);
      objects.push(object);
    }
  }

  if (objects.length === 0) {
    throw new OsmCityUpdateValidationError(
      'OSM ID index contains no enabled named place/admin boundary objects',
    );
  }

  objects.sort((left, right) =>
    left.osmType.localeCompare(right.osmType) || left.osmId - right.osmId);

  return {
    objects,
    sourceElements,
    duplicateIndexObjects,
    osmTimestamp: timestamps.length > 0
      ? new Date(Math.min(...timestamps)).toISOString()
      : null,
  };
}

export function createObjectBatches(objects, batchSize) {
  const batches = [];
  for (let offset = 0; offset < objects.length; offset += batchSize) {
    batches.push(objects.slice(offset, offset + batchSize));
  }
  return batches;
}
