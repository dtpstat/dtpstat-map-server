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
    }
  }
}

/** @param {unknown} value @param {number} featureIndex */
function portableMetadata(value, featureIndex) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GeoJsonValidationError(
      `GeoJSON feature ${featureIndex} has invalid _dtpstat metadata`,
    );
  }

  const citySlug = value.citySlug === undefined || value.citySlug === null
    ? null
    : String(value.citySlug).trim();
  if (value.citySlug !== undefined && !citySlug) {
    throw new GeoJsonValidationError(
      `GeoJSON feature ${featureIndex} has invalid _dtpstat.citySlug`,
    );
  }

  const boundaryOsmType = value.boundaryOsmType ?? null;
  const boundaryOsmIdRaw = value.boundaryOsmId ?? null;
  const hasBoundary = boundaryOsmType !== null || boundaryOsmIdRaw !== null;
  if (hasBoundary && !['way', 'relation'].includes(boundaryOsmType)) {
    throw new GeoJsonValidationError(
      `GeoJSON feature ${featureIndex} has invalid _dtpstat.boundaryOsmType`,
    );
  }
  const boundaryOsmId = boundaryOsmIdRaw === null
    ? null
    : Number(boundaryOsmIdRaw);
  if (
    hasBoundary &&
    (!Number.isSafeInteger(boundaryOsmId) || boundaryOsmId <= 0)
  ) {
    throw new GeoJsonValidationError(
      `GeoJSON feature ${featureIndex} has invalid _dtpstat.boundaryOsmId`,
    );
  }

  return {
    citySlug: citySlug || null,
    boundaryOsmType: hasBoundary ? boundaryOsmType : null,
    boundaryOsmId: hasBoundary ? boundaryOsmId : null,
  };
}

/**
 * Validate a complete line GeoJSON upload. Legacy exports are accepted through
 * short_name/lanes. Versioned exports may additionally carry portable linkage
 * metadata in properties._dtpstat so city and OSM-boundary associations can be
 * restored on another server without relying on local surrogate IDs.
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

    const metadata = portableMetadata(feature.properties._dtpstat, featureIndex);
    const rawCityName = feature.properties.short_name;
    let cityName = null;
    if (rawCityName !== null && rawCityName !== undefined && rawCityName !== '') {
      if (typeof rawCityName !== 'string' || !rawCityName.trim()) {
        throw new GeoJsonValidationError(
          `GeoJSON feature ${featureIndex} has an invalid short_name`,
        );
      }
      cityName = rawCityName.trim();
    }

    if (!cityName && metadata.boundaryOsmId === null) {
      ignoredFeatures.push(featureIndex);
      continue;
    }

    const lanes = finiteNumber(feature.properties.lanes);
    if (!Number.isSafeInteger(lanes) || (lanes !== 1 && lanes !== 2)) {
      throw new GeoJsonValidationError(
        `GeoJSON feature ${featureIndex} must have lanes equal to 1 or 2`,
      );
    }

    validateGeometry(feature.geometry, featureIndex);
    let citySlug = metadata.citySlug;
    if (cityName) {
      citySlug ||= slugify(cityName);
      let city = cityByName.get(cityName);
      if (!city) {
        city = {
          slug: citySlug,
          name: cityName,
          fullName:
            typeof feature.properties.name === 'string' &&
            feature.properties.name.trim()
              ? feature.properties.name.trim()
              : cityName,
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
      } else if (city.slug !== citySlug) {
        throw new GeoJsonValidationError(
          `GeoJSON has conflicting city slugs for ${cityName}`,
        );
      }
    }

    geometries.push({
      cityName,
      citySlug,
      boundaryOsmType: metadata.boundaryOsmType,
      boundaryOsmId: metadata.boundaryOsmId,
      lanes,
      properties: feature.properties,
      geometry: feature.geometry,
    });
  }

  const cities = [...cityByName.values()];
  if (geometries.length === 0) {
    throw new GeoJsonValidationError(
      'FeatureCollection contains no transferable line geometries',
    );
  }

  const slugCount = new Set(cities.map((city) => city.slug)).size;
  if (slugCount !== cities.length) {
    throw new GeoJsonValidationError('GeoJSON produces duplicate city slugs');
  }

  return { cities, geometries, ignoredFeatures };
}
