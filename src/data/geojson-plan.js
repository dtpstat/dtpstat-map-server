export class GeoJsonValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeoJsonValidationError';
  }
}

/** @param {string} name */
export function slugify(name) {
  return name
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

/** @param {unknown} value */
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} geometry
 * @param {number} featureIndex
 * @returns {[number, number, number, number]}
 */
function validateGeometry(geometry, featureIndex) {
  if (!geometry || typeof geometry !== 'object') {
    throw new GeoJsonValidationError(
      `GeoJSON feature ${featureIndex} has no geometry`,
    );
  }

  const { type, coordinates } = geometry;
  if (type !== 'LineString' && type !== 'MultiLineString') {
    throw new GeoJsonValidationError(
      `GeoJSON feature ${featureIndex} must be a LineString or MultiLineString`,
    );
  }

  const lines = type === 'LineString' ? [coordinates] : coordinates;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new GeoJsonValidationError(
      `GeoJSON feature ${featureIndex} has empty coordinates`,
    );
  }

  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2) {
      throw new GeoJsonValidationError(
        `GeoJSON feature ${featureIndex} contains an invalid line`,
      );
    }

    for (const position of line) {
      if (!Array.isArray(position) || position.length < 2) {
        throw new GeoJsonValidationError(
          `GeoJSON feature ${featureIndex} contains an invalid position`,
        );
      }
      const longitude = finiteNumber(position[0]);
      const latitude = finiteNumber(position[1]);
      if (
        longitude === null ||
        latitude === null ||
        longitude < -180 ||
        longitude > 180 ||
        latitude < -90 ||
        latitude > 90
      ) {
        throw new GeoJsonValidationError(
          `GeoJSON feature ${featureIndex} contains coordinates outside WGS84`,
        );
      }

      bounds[0] = Math.min(bounds[0], longitude);
      bounds[1] = Math.min(bounds[1], latitude);
      bounds[2] = Math.max(bounds[2], longitude);
      bounds[3] = Math.max(bounds[3], latitude);
    }
  }

  return bounds;
}

/**
 * Validate a complete GeoJSON upload and derive city records and statistics.
 * Unnamed features are ignored because the legacy dataset contains duplicate
 * or unclassified spatial-join artifacts without `short_name`.
 *
 * @param {unknown} collection
 */
export function buildGeoJsonPlan(collection) {
  if (
    !collection ||
    typeof collection !== 'object' ||
    collection.type !== 'FeatureCollection' ||
    !Array.isArray(collection.features)
  ) {
    throw new GeoJsonValidationError(
      'Request body must be a GeoJSON FeatureCollection',
    );
  }

  const cityByName = new Map();
  const geometries = [];
  const ignoredFeatures = [];

  for (const [featureIndex, feature] of collection.features.entries()) {
    if (
      !feature ||
      feature.type !== 'Feature' ||
      !feature.properties ||
      typeof feature.properties !== 'object' ||
      Array.isArray(feature.properties)
    ) {
      throw new GeoJsonValidationError(
        `GeoJSON feature ${featureIndex} is not a valid Feature`,
      );
    }

    const rawCityName = feature.properties.short_name;
    if (rawCityName === null || rawCityName === undefined || rawCityName === '') {
      ignoredFeatures.push(featureIndex);
      continue;
    }
    if (typeof rawCityName !== 'string' || !rawCityName.trim()) {
      throw new GeoJsonValidationError(
        `GeoJSON feature ${featureIndex} has an invalid short_name`,
      );
    }

    const cityName = rawCityName.trim();
    const lanes = finiteNumber(feature.properties.lanes);
    if (!Number.isSafeInteger(lanes) || (lanes !== 1 && lanes !== 2)) {
      throw new GeoJsonValidationError(
        `GeoJSON feature ${featureIndex} must have lanes equal to 1 or 2`,
      );
    }

    const featureBounds = validateGeometry(feature.geometry, featureIndex);
    let city = cityByName.get(cityName);
    if (!city) {
      city = {
        slug: slugify(cityName),
        name: cityName,
        fullName:
          typeof feature.properties.name === 'string' &&
          feature.properties.name.trim()
            ? feature.properties.name.trim()
            : cityName,
        bounds: [...featureBounds],
        attributes: {
          adminLevel: feature.properties.admin_level,
          place: feature.properties.place,
          type: feature.properties.type,
        },
      };
      if (!city.slug) {
        throw new GeoJsonValidationError(`Cannot create a slug for ${cityName}`);
      }
      cityByName.set(cityName, city);
    } else {
      city.bounds[0] = Math.min(city.bounds[0], featureBounds[0]);
      city.bounds[1] = Math.min(city.bounds[1], featureBounds[1]);
      city.bounds[2] = Math.max(city.bounds[2], featureBounds[2]);
      city.bounds[3] = Math.max(city.bounds[3], featureBounds[3]);
    }
    geometries.push({
      cityName,
      lanes,
      properties: feature.properties,
      geometry: feature.geometry,
    });
  }

  const cities = [...cityByName.values()];
  if (cities.length === 0 || geometries.length === 0) {
    throw new GeoJsonValidationError(
      'FeatureCollection contains no named city geometries',
    );
  }

  const slugCount = new Set(cities.map((city) => city.slug)).size;
  if (slugCount !== cities.length) {
    throw new GeoJsonValidationError('GeoJSON produces duplicate city slugs');
  }

  return { cities, geometries, ignoredFeatures };
}
