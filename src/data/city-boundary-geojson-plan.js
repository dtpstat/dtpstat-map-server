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
  const displayType = optionalString(
    city.displayType ?? city.display_type,
    'city.displayType',
    featureIndex,
  ) ?? 'city';
  return { slug, name, fullName, displayType, attributes };
}

function normalizeFeature(feature, featureIndex) {
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
  const rawPlaceType = properties.placeType ?? properties.place_type ?? null;
  const placeType = rawPlaceType === null || rawPlaceType === ''
    ? null
    : rawPlaceType;
  if (placeType !== null && !['city', 'town'].includes(placeType)) {
    throw new CityBoundaryGeoJsonValidationError(
      `City GeoJSON feature ${featureIndex} has invalid placeType`,
    );
  }
  const rawAdminLevel = properties.adminLevel ?? properties.admin_level ?? null;
  const adminLevel = rawAdminLevel === null || rawAdminLevel === ''
    ? null
    : Number(rawAdminLevel);
  if (
    adminLevel !== null &&
    (!Number.isInteger(adminLevel) || adminLevel < 1 || adminLevel > 20)
  ) {
    throw new CityBoundaryGeoJsonValidationError(
      `City GeoJSON feature ${featureIndex} has invalid adminLevel`,
    );
  }
  if (placeType === null && adminLevel === null) {
    throw new CityBoundaryGeoJsonValidationError(
      `City GeoJSON feature ${featureIndex} must describe a place or administrative boundary`,
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
  const active = properties.active === undefined
    ? placeType !== null
    : properties.active;
  if (typeof active !== 'boolean') {
    throw new CityBoundaryGeoJsonValidationError(
      `City GeoJSON feature ${featureIndex} has invalid active flag`,
    );
  }
  const displayName = optionalString(
    properties.displayName ?? properties.display_name ?? osmName,
    'displayName',
    featureIndex,
  );
  const displayType = optionalString(
    properties.displayType ??
      properties.display_type ??
      placeType ??
      'administrative',
    'displayType',
    featureIndex,
  );
  const updatedAt = validTimestamp(
    properties.updatedAt ?? properties.updated_at,
  );
  if (updatedAt === undefined) {
    throw new CityBoundaryGeoJsonValidationError(
      `City GeoJSON feature ${featureIndex} has invalid updatedAt`,
    );
  }

  const city = linkedCity(properties, featureIndex);
  return {
    boundary: {
      placeType,
      adminLevel,
      active,
      displayName,
      displayType,
      osmType,
      osmId,
      osmName,
      tags,
      osmTimestamp,
      updatedAt,
      citySlug: city?.slug ?? null,
      cityName: city?.name ?? null,
      geometry: feature.geometry,
    },
    city,
  };
}

export function createCityBoundaryGeoJsonAccumulator({
  collectBoundaries = false,
} = {}) {
  const objectKeys = new Set();
  const citiesBySlug = new Map();
  const boundaries = collectBoundaries ? [] : null;
  let boundaryCount = 0;

  return {
    addFeature(feature, featureIndex = boundaryCount) {
      const { boundary, city } = normalizeFeature(feature, featureIndex);
      const key = `${boundary.osmType}/${boundary.osmId}`;
      if (objectKeys.has(key)) {
        throw new CityBoundaryGeoJsonValidationError(
          `City GeoJSON contains duplicate OSM object ${key}`,
        );
      }
      objectKeys.add(key);

      if (city) {
        const previous = citiesBySlug.get(city.slug);
        if (
          previous &&
          JSON.stringify(previous) !== JSON.stringify(city)
        ) {
          throw new CityBoundaryGeoJsonValidationError(
            `City GeoJSON contains conflicting properties for city ${city.slug}`,
          );
        }
        citiesBySlug.set(city.slug, city);
      }

      boundaryCount += 1;
      boundaries?.push(boundary);
      return boundary;
    },

    finish(metadata = {}) {
      if (metadata.type !== undefined && metadata.type !== 'FeatureCollection') {
        throw new CityBoundaryGeoJsonValidationError(
          'Request body must be a GeoJSON FeatureCollection',
        );
      }
      if (boundaryCount === 0) {
        throw new CityBoundaryGeoJsonValidationError(
          'Request body must be a non-empty GeoJSON FeatureCollection',
        );
      }
      return {
        boundaryCount,
        boundaries: boundaries ?? [],
        cities: [...citiesBySlug.values()],
      };
    },
  };
}

export function buildCityBoundaryGeoJsonPlan(collection) {
  if (
    !collection ||
    typeof collection !== 'object' ||
    collection.type !== 'FeatureCollection' ||
    !Array.isArray(collection.features)
  ) {
    throw new CityBoundaryGeoJsonValidationError(
      'Request body must be a non-empty GeoJSON FeatureCollection',
    );
  }

  const accumulator = createCityBoundaryGeoJsonAccumulator({
    collectBoundaries: true,
  });
  for (const [featureIndex, feature] of collection.features.entries()) {
    accumulator.addFeature(feature, featureIndex);
  }
  const result = accumulator.finish({ type: collection.type });
  return {
    boundaries: result.boundaries,
    cities: result.cities,
  };
}
