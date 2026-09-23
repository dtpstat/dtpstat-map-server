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

function warning(code, message, details = {}) {
  return {
    code,
    message,
    skipped: Boolean(details.skipped),
    ...details,
  };
}

function cityLabel(regionName, cityIndex) {
  return `City ${regionName} cities[${cityIndex}]`;
}

export function createPopulationHierarchyAccumulator({
  asOf: rawAsOf,
  source: rawSource,
  maxItems = 5_000_000,
  collectCities = false,
} = {}) {
  // Top-level metadata is part of the document contract and remains fatal.
  const defaults = {
    asOf: normalizeDate(rawAsOf, 'asOf'),
    source: normalizeSource(rawSource, 'source'),
  };
  const seenRegions = new Map();
  const seenCities = new Set();
  const collected = collectCities ? [] : null;
  const warnings = [];
  let regionCount = 0;
  let uniqueRegionCount = 0;
  let cityCount = 0;
  let encounteredCityCount = 0;
  let skippedCityCount = 0;
  let skippedRegionCount = 0;

  function addWarning(value) {
    warnings.push(value);
  }

  return {
    addRegion(rawRegion, regionIndex = regionCount) {
      regionCount += 1;

      let region;
      try {
        region = object(rawRegion, `Region regions[${regionIndex}]`);
      } catch (error) {
        skippedRegionCount += 1;
        addWarning(warning(
          'invalid-region',
          error.message,
          {
            scope: 'region',
            regionIndex,
            skipped: true,
          },
        ));
        return { regionName: null, regionAttributes: {}, rows: [] };
      }

      const allowedRegion = new Set(['name', 'attributes', 'cities']);
      const unknownRegion = Object.keys(region)
        .filter((key) => !allowedRegion.has(key));
      if (unknownRegion.length > 0) {
        addWarning(warning(
          'unsupported-region-properties',
          `Region regions[${regionIndex}] contains unsupported properties: ${unknownRegion.join(', ')}`,
          {
            scope: 'region',
            regionIndex,
            properties: unknownRegion,
            skipped: false,
          },
        ));
      }

      let regionName;
      try {
        regionName = normalizeText(
          region.name,
          `Region regions[${regionIndex}] name`,
        );
      } catch (error) {
        const skippedCities = Array.isArray(region.cities)
          ? region.cities.length
          : 0;
        encounteredCityCount += skippedCities;
        skippedCityCount += skippedCities;
        skippedRegionCount += 1;
        addWarning(warning(
          'invalid-region-name',
          error.message,
          {
            scope: 'region',
            regionIndex,
            skippedCities,
            skipped: true,
          },
        ));
        return { regionName: null, regionAttributes: {}, rows: [] };
      }

      const regionKey = nameKey(regionName);
      const existingRegionName = seenRegions.get(regionKey);
      const canonicalRegionName = existingRegionName ?? regionName;
      if (existingRegionName) {
        addWarning(warning(
          'duplicate-region-merged',
          `Duplicate region name merged with previous block: ${regionName}`,
          {
            scope: 'region',
            regionIndex,
            regionName,
            skipped: false,
          },
        ));
      } else {
        seenRegions.set(regionKey, regionName);
        uniqueRegionCount += 1;
      }

      let regionAttributes = {};
      try {
        regionAttributes = normalizeAttributes(
          region.attributes,
          `Region regions[${regionIndex}] attributes`,
        );
      } catch (error) {
        addWarning(warning(
          'invalid-region-attributes',
          `${error.message}; empty attributes used`,
          {
            scope: 'region',
            regionIndex,
            regionName: canonicalRegionName,
            skipped: false,
          },
        ));
      }

      if (!Array.isArray(region.cities) || region.cities.length === 0) {
        skippedRegionCount += 1;
        addWarning(warning(
          'invalid-region-cities',
          `Region regions[${regionIndex}] must contain a non-empty cities array`,
          {
            scope: 'region',
            regionIndex,
            regionName: canonicalRegionName,
            skipped: true,
          },
        ));
        return {
          regionName: canonicalRegionName,
          regionAttributes,
          rows: [],
        };
      }

      // A huge invalid document must not bypass resource limits by being
      // rejected item-by-item.
      if (encounteredCityCount + region.cities.length > maxItems) {
        throw new PopulationValidationError(
          `Population hierarchy contains more than ${maxItems} cities`,
        );
      }

      const rows = [];
      for (const [cityIndex, rawCity] of region.cities.entries()) {
        encounteredCityCount += 1;
        const label = cityLabel(canonicalRegionName, cityIndex);

        let city;
        try {
          city = object(rawCity, label);
        } catch (error) {
          skippedCityCount += 1;
          addWarning(warning(
            'invalid-city',
            error.message,
            {
              scope: 'city',
              regionIndex,
              cityIndex,
              regionName: canonicalRegionName,
              skipped: true,
            },
          ));
          continue;
        }

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
          addWarning(warning(
            'unsupported-city-properties',
            `${label} contains unsupported properties: ${unknownCity.join(', ')}`,
            {
              scope: 'city',
              regionIndex,
              cityIndex,
              regionName: canonicalRegionName,
              properties: unknownCity,
              skipped: false,
            },
          ));
        }

        if (!Object.hasOwn(city, 'population')) {
          skippedCityCount += 1;
          addWarning(warning(
            'missing-population',
            `${label} must contain population`,
            {
              scope: 'city',
              regionIndex,
              cityIndex,
              regionName: canonicalRegionName,
              cityName: typeof city.name === 'string' ? city.name : null,
              skipped: true,
            },
          ));
          continue;
        }

        let cityName;
        try {
          cityName = normalizeText(city.name, `${label} name`);
        } catch (error) {
          skippedCityCount += 1;
          addWarning(warning(
            'invalid-city-name',
            error.message,
            {
              scope: 'city',
              regionIndex,
              cityIndex,
              regionName: canonicalRegionName,
              skipped: true,
            },
          ));
          continue;
        }

        const cityIdentity = `${regionKey}/${nameKey(cityName)}`;
        if (seenCities.has(cityIdentity)) {
          skippedCityCount += 1;
          addWarning(warning(
            'duplicate-city',
            `Duplicate city name inside region ${canonicalRegionName}: ${cityName}`,
            {
              scope: 'city',
              regionIndex,
              cityIndex,
              regionName: canonicalRegionName,
              cityName,
              skipped: true,
            },
          ));
          continue;
        }

        try {
          const row = {
            regionName: canonicalRegionName,
            regionAttributes,
            cityName,
            population: normalizePopulation(
              city.population,
              `${label} population`,
            ),
            asOf: city.asOf === undefined
              ? defaults.asOf
              : normalizeDate(city.asOf, `${label} asOf`),
            source: city.source === undefined
              ? defaults.source
              : normalizeSource(city.source, `${label} source`),
            attributes: normalizeAttributes(
              city.attributes,
              `${label} attributes`,
            ),
          };
          seenCities.add(cityIdentity);
          rows.push(row);
          cityCount += 1;
          collected?.push(row);
        } catch (error) {
          skippedCityCount += 1;
          addWarning(warning(
            'invalid-city-data',
            error.message,
            {
              scope: 'city',
              regionIndex,
              cityIndex,
              regionName: canonicalRegionName,
              cityName,
              skipped: true,
            },
          ));
        }
      }

      return { regionName: canonicalRegionName, regionAttributes, rows };
    },

    finish(metadata = {}) {
      // Schema mismatch and an empty document are document-level failures.
      normalizeSchemaVersion(metadata.schemaVersion);
      if (regionCount === 0) {
        throw new PopulationValidationError(
          'Request body must contain a non-empty regions array',
        );
      }
      return {
        schemaVersion: 2,
        asOf: defaults.asOf,
        source: defaults.source,
        regionCount,
        uniqueRegionCount,
        cityCount,
        encounteredCityCount,
        skippedCityCount,
        skippedRegionCount,
        warnings: [...warnings],
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
      'Request body must contain a regions array',
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
