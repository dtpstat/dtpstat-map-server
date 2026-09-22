export class PopulationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PopulationValidationError';
  }
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value;
}

function normalizeDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !validDate(value)) {
    throw new PopulationValidationError(
      `${field} must use YYYY-MM-DD format`,
    );
  }
  return value;
}

function normalizeSource(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw new PopulationValidationError(
      `${field} must be a non-empty string up to 500 characters`,
    );
  }
  return value.trim();
}

function normalizeText(value, field, max = 160) {
  if (typeof value !== 'string') {
    throw new PopulationValidationError(`${field} must be a string`);
  }
  const normalized = value.trim().normalize('NFC');
  if (!normalized || normalized.length > max) {
    throw new PopulationValidationError(
      `${field} must contain 1-${max} characters`,
    );
  }
  return normalized;
}

function normalizePopulation(value, field) {
  if (value === null) return null;
  const population = Number(value);
  if (
    !Number.isSafeInteger(population) ||
    population <= 0 ||
    population > 2147483647
  ) {
    throw new PopulationValidationError(
      `${field} must be a positive integer up to 2147483647 or null`,
    );
  }
  return population;
}

function normalizeAttributes(value, field) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PopulationValidationError(
      `${field} must be a JSON object`,
    );
  }
  return value;
}

function normalizeSchemaVersion(value) {
  const version = Number(value);
  if (version !== 2) {
    throw new PopulationValidationError(
      'Population hierarchy schemaVersion must equal 2',
    );
  }
  return version;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PopulationValidationError(`${label} must be an object`);
  }
  return value;
}

function nameKey(value) {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeRegion(raw, regionIndex, defaults, seenRegions, seenCities) {
  const region = object(raw, `Region regions[${regionIndex}]`);
  const allowedRegion = new Set(['name', 'attributes', 'cities']);
  const unknownRegion = Object.keys(region)
    .filter((key) => !allowedRegion.has(key));
  if (unknownRegion.length > 0) {
    throw new PopulationValidationError(
      `Region regions[${regionIndex}] contains unsupported properties: ` +
      unknownRegion.join(', '),
    );
  }

  const regionName = normalizeText(
    region.name,
    `Region regions[${regionIndex}] name`,
  );
  const regionKey = nameKey(regionName);
  if (seenRegions.has(regionKey)) {
    throw new PopulationValidationError(
      `Duplicate region name: ${regionName}`,
    );
  }
  seenRegions.add(regionKey);

  const regionAttributes = normalizeAttributes(
    region.attributes,
    `Region regions[${regionIndex}] attributes`,
  );

  if (!Array.isArray(region.cities) || region.cities.length === 0) {
    throw new PopulationValidationError(
      `Region regions[${regionIndex}] must contain a non-empty cities array`,
    );
  }

  const rows = [];
  for (const [cityIndex, rawCity] of region.cities.entries()) {
    const city = object(
      rawCity,
      `City regions[${regionIndex}].cities[${cityIndex}]`,
    );
    const allowedCity = new Set([
      'name',
      'population',
      'asOf',
      'source',
      'attributes',
    ]);
    const unknownCity = Object.keys(city)
      .filter((key) => !allowedCity.has(key));
    if (unknownCity.length > 0) {
      throw new PopulationValidationError(
        `City regions[${regionIndex}].cities[${cityIndex}] contains unsupported properties: ` +
        unknownCity.join(', '),
      );
    }
    if (!Object.hasOwn(city, 'population')) {
      throw new PopulationValidationError(
        `City regions[${regionIndex}].cities[${cityIndex}] must contain population`,
      );
    }

    const cityName = normalizeText(
      city.name,
      `City regions[${regionIndex}].cities[${cityIndex}] name`,
    );
    const cityIdentity = `${regionKey}/${nameKey(cityName)}`;
    if (seenCities.has(cityIdentity)) {
      throw new PopulationValidationError(
        `Duplicate city name inside region ${regionName}: ${cityName}`,
      );
    }
    seenCities.add(cityIdentity);

    rows.push({
      regionName,
      regionAttributes,
      cityName,
      population: normalizePopulation(
        city.population,
        `City regions[${regionIndex}].cities[${cityIndex}] population`,
      ),
      asOf: city.asOf === undefined
        ? defaults.asOf
        : normalizeDate(
          city.asOf,
          `City regions[${regionIndex}].cities[${cityIndex}] asOf`,
        ),
      source: city.source === undefined
        ? defaults.source
        : normalizeSource(
          city.source,
          `City regions[${regionIndex}].cities[${cityIndex}] source`,
        ),
      attributes: normalizeAttributes(
        city.attributes,
        `City regions[${regionIndex}].cities[${cityIndex}] attributes`,
      ),
    });
  }

  return { regionName, regionAttributes, rows };
}

export function createPopulationHierarchyAccumulator({
  asOf: rawAsOf,
  source: rawSource,
  maxItems = 5_000_000,
  collectCities = false,
} = {}) {
  const defaults = {
    asOf: normalizeDate(rawAsOf, 'asOf'),
    source: normalizeSource(rawSource, 'source'),
  };
  const seenRegions = new Set();
  const seenCities = new Set();
  const collected = collectCities ? [] : null;
  let regionCount = 0;
  let cityCount = 0;

  return {
    addRegion(region, regionIndex = regionCount) {
      const normalized = normalizeRegion(
        region,
        regionIndex,
        defaults,
        seenRegions,
        seenCities,
      );
      if (cityCount + normalized.rows.length > maxItems) {
        throw new PopulationValidationError(
          `Population hierarchy contains more than ${maxItems} cities`,
        );
      }
      regionCount += 1;
      cityCount += normalized.rows.length;
      collected?.push(...normalized.rows);
      return normalized;
    },

    finish(metadata = {}) {
      normalizeSchemaVersion(metadata.schemaVersion);
      if (regionCount === 0 || cityCount === 0) {
        throw new PopulationValidationError(
          'Request body must contain a non-empty regions array',
        );
      }
      return {
        schemaVersion: 2,
        asOf: defaults.asOf,
        source: defaults.source,
        regionCount,
        cityCount,
        cities: collected ?? [],
      };
    },
  };
}

export function buildPopulationPlan(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PopulationValidationError(
      'Request body must be a JSON object',
    );
  }
  if (!Array.isArray(payload.regions)) {
    throw new PopulationValidationError(
      'Request body must contain a non-empty regions array',
    );
  }

  const accumulator = createPopulationHierarchyAccumulator({
    asOf: payload.asOf,
    source: payload.source,
    maxItems: options.maxItems,
    collectCities: true,
  });
  for (const [index, region] of payload.regions.entries()) {
    accumulator.addRegion(region, index);
  }
  return accumulator.finish({ schemaVersion: payload.schemaVersion });
}
