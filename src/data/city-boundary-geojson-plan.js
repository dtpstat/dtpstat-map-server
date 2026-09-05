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

/** @param {Record<string, any>} properties @param {number} featureIndex */
function linkedCity(properties, featureIndex) {
  const nested = properties.city;
  if (
    nested !== undefined &&
    nested !== null &&
    (!nested || typeof nested !== 'object' || Array.isArray(nested))
  ) {
    throw new CityBoundaryGeoJsonValidationError(
      `City GeoJSON feature ${featureIndex} has invalid city properties`,
    );
  }

  const city = nested ?? {};
  const slug = optionalString(
    city.slug ?? properties.citySlug ?? properties.city_slug,
    'city.slug',
    featureIndex,
  );
  const name = optionalString(
    city.name ?? properties.cityName ?? properties.city_name,
    'city.name',
    featureIndex,
  );
  if (!slug && !name) return null;
  if (!slug || !name) {
    throw new CityBoundaryGeoJsonValidationError(
      `City GeoJSON feature ${featureIndex} must contain both city slug and name`,
    );
  }

  const fullName = optionalString(
    city.fullName ?? city.full_name,
    'city.fullName',
    featureIndex,
  );
  const attributes = city.attributes ?? {};
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new CityBoundaryGeoJsonValidationError(
      `City GeoJSON feature ${featureIndex} has invalid city.attributes`,
    );
  }
  return { slug, name, fullName, attributes };
}

/**
 * Validate a portable full snapshot of OSM place boundaries and the optional
 * ranked-city records linked to those boundaries. Local database identity
 * values and derived ranking fields are intentionally not transferred.
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
  const citiesBySlug = new Map();
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
    const updatedAt = validTimestamp(
      properties.updatedAt ?? properties.updated_at,
    );
    if (updatedAt === undefined) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON feature ${featureIndex} has invalid updatedAt`,
      );
    }

    const key = `${osmType}/${osmId}`;
    if (objectKeys.has(key)) {
      throw new CityBoundaryGeoJsonValidationError(
        `City GeoJSON contains duplicate OSM object ${key}`,
      );
    }
    objectKeys.add(key);

    const city = linkedCity(properties, featureIndex);
    if (city) {
      const previous = citiesBySlug.get(city.slug);
      if (previous && JSON.stringify(previous) !== JSON.stringify(city)) {
        throw new CityBoundaryGeoJsonValidationError(
          `City GeoJSON contains conflicting properties for city ${city.slug}`,
        );
      }
      citiesBySlug.set(city.slug, city);
    }

    return {
      placeType,
      osmType,
      osmId,
      osmName,
      tags,
      osmTimestamp,
      updatedAt,
      citySlug: city?.slug ?? null,
      cityName: city?.name ?? null,
      geometry: feature.geometry,
    };
  });

  return { boundaries, cities: [...citiesBySlug.values()] };
}
