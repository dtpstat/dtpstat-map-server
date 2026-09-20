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

function normalizeType(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new PopulationValidationError(
      `${field} must be a string or null`,
    );
  }
  const normalized = value.trim().normalize('NFC');
  if (!normalized || normalized.length > 80) {
    throw new PopulationValidationError(
      `${field} must contain 1-80 characters`,
    );
  }
  return normalized;
}

function comparable(value) {
  return String(value ?? '')
    .replace(/\s+/gu, '')
    .toLocaleLowerCase('ru-RU');
}

export function createPopulationAccumulator({
  asOf: rawAsOf,
  source: rawSource,
  collectPopulations = false,
} = {}) {
  const asOf = normalizeDate(rawAsOf, 'asOf');
  const source = normalizeSource(rawSource, 'source');
  const names = new Set();
  const populations = collectPopulations ? [] : null;
  let populationCount = 0;

  return {
    addItem(item, index = populationCount) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new PopulationValidationError(
          `Population item ${index} must be an object`,
        );
      }
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name) {
        throw new PopulationValidationError(
          `Population item ${index} has an invalid name`,
        );
      }
      const type = normalizeType(
        item.type,
        `Population item ${index} type`,
      );
      const identity = `${comparable(type)}|${comparable(name)}`;
      if (names.has(identity)) {
        throw new PopulationValidationError(
          `Duplicate city identity: ${type ? `${type} / ` : ''}${name}`,
        );
      }
      names.add(identity);

      const population = Number(item.population);
      if (
        !Number.isSafeInteger(population) ||
        population <= 0 ||
        population > 2147483647
      ) {
        throw new PopulationValidationError(
          `Population item ${index} has an invalid population`,
        );
      }
      const attributes = item.attributes ?? {};
      if (
        !attributes ||
        typeof attributes !== 'object' ||
        Array.isArray(attributes)
      ) {
        throw new PopulationValidationError(
          `Population item ${index} has invalid attributes`,
        );
      }

      const normalized = {
        name,
        ...(type === null ? {} : { type }),
        population,
        asOf: item.asOf === undefined
          ? asOf
          : normalizeDate(
              item.asOf,
              `Population item ${index} asOf`,
            ),
        source: item.source === undefined
          ? source
          : normalizeSource(
              item.source,
              `Population item ${index} source`,
            ),
        attributes,
      };
      populationCount += 1;
      populations?.push(normalized);
      return normalized;
    },

    finish() {
      if (populationCount === 0) {
        throw new PopulationValidationError(
          'Request body must contain a non-empty populations array',
        );
      }
      return {
        asOf,
        source,
        populationCount,
        populations: populations ?? [],
      };
    },
  };
}

export function buildPopulationPlan(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PopulationValidationError(
      'Request body must be a JSON object',
    );
  }
  if (!Array.isArray(payload.populations)) {
    throw new PopulationValidationError(
      'Request body must contain a non-empty populations array',
    );
  }

  const accumulator = createPopulationAccumulator({
    asOf: payload.asOf,
    source: payload.source,
    collectPopulations: true,
  });
  for (const [index, item] of payload.populations.entries()) {
    accumulator.addItem(item, index);
  }
  const result = accumulator.finish();
  return {
    asOf: result.asOf,
    source: result.source,
    populations: result.populations,
  };
}
