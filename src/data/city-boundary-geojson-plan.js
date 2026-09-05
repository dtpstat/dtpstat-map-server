export class CityBoundaryGeoJsonValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CityBoundaryGeoJsonValidationError';
  }
}

/** @param {unknown} value */
function optionalString(value, field, featureIndex) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new CityBoundaryGeoJsonValidationError(
      `City GeoJSON feature ${featureIndex} has invalid ${field}`,
    );
  }
  return value.trim();
}

/** @param {unknown} value */
function validTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return undefined;
  }
  return new Date(value).toISOString();
}

/** @param {unknown} coordinates @param {number} featureIndex */
function validatePositions(coordinates, featureIndex) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw new CityBoundaryGeoJsonValidationError(
      `City GeoJSON feature ${featureIndex} has empty coordinates`,
    );
  }
  const stack = [coordinates];
  let positions = 0;
  while (stack.length > 0) {
    const value = stack.pop();
    if (!Array.isArray(value) || value.length === 0) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON feature ${featureIndex} has invalid coordinates`,
      );
    }
    if (
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      const [longitude, latitude] = value;
      if (
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude) ||
        longitude < -180 || longitude > 180 ||
        latitude < -90 || latitude > 90
      ) {
        throw new CityBoundaryGeoJsonValidationError(
          `City GeoJSON feature ${featureIndex} contains coordinates outside WGS84`,
        );
      }
      positions += 1;
      continue;
    }
    for (const child of value) stack.push(child);
  }
  if (positions < 4) {
    throw new CityBoundaryGeoJsonValidationError(
      `City GeoJSON feature ${featureIndex} has too few polygon positions`,
    );
  }
}

/**
 * Validate a portable full snapshot of OSM place boundaries. Local database
 * identity values are intentionally not part of the transfer contract.
 *
 * @param {unknown} collection
 */
export function buildCityBoundaryGeoJsonPlan(collection) {
  if (
    !collection ||
    typeof collection !== 'object' ||
    collection.type !== 'FeatureCollection' ||
    !Array.isArray(collection.features) ||
    collection.features.length === 0
  ) {
    throw new CityBoundaryGeoJsonValidationError(
      'Request body must be a non-empty GeoJSON FeatureCollection',
    );
  }

  const objectKeys = new Set();
  const boundaries = collection.features.map((feature, featureIndex) => {
    if (
      !feature ||
      feature.type !== 'Feature' ||
      !feature.properties ||
      typeof feature.properties !== 'object' ||
      Array.isArray(feature.properties)
    ) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON feature ${featureIndex} is not a valid Feature`,
      );
    }
    if (
      !feature.geometry ||
      !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)
    ) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON feature ${featureIndex} must be a Polygon or MultiPolygon`,
      );
    }
    validatePositions(feature.geometry.coordinates, featureIndex);

    const properties = feature.properties;
    const placeType = properties.placeType ?? properties.place_type;
    if (!['city', 'town'].includes(placeType)) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON feature ${featureIndex} must have placeType city or town`,
      );
    }
    const osmType = properties.osmType ?? properties.osm_type;
    if (!['way', 'relation'].includes(osmType)) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON feature ${featureIndex} must have osmType way or relation`,
      );
    }
    const osmId = Number(properties.osmId ?? properties.osm_id);
    if (!Number.isSafeInteger(osmId) || osmId <= 0) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON feature ${featureIndex} has invalid osmId`,
      );
    }
    const osmName = optionalString(
      properties.osmName ?? properties.osm_name ?? properties.name,
      'osmName',
      featureIndex,
    );
    if (!osmName) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON feature ${featureIndex} has no osmName`,
      );
    }
    const tags = properties.tags ?? {};
    if (!tags || typeof tags !== 'object' || Array.isArray(tags)) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON feature ${featureIndex} has invalid tags`,
      );
    }
    const osmTimestamp = validTimestamp(
      properties.osmTimestamp ?? properties.osm_timestamp,
    );
    if (osmTimestamp === undefined) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON feature ${featureIndex} has invalid osmTimestamp`,
      );
    }

    const key = `${osmType}/${osmId}`;
    if (objectKeys.has(key)) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON contains duplicate OSM object ${key}`,
      );
    }
    objectKeys.add(key);

    return {
      placeType,
      osmType,
      osmId,
      osmName,
      tags,
      osmTimestamp,
      citySlug: optionalString(
        properties.citySlug ?? properties.city_slug,
        'citySlug',
        featureIndex,
      ),
      cityName: optionalString(
        properties.cityName ?? properties.city_name,
        'cityName',
        featureIndex,
      ),
      geometry: feature.geometry,
    };
  });

  return { boundaries };
}
