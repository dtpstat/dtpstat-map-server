export class PopulationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PopulationValidationError';
  }
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** @param {unknown} value @param {string} field */
function normalizeDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !validDate(value)) {
    throw new PopulationValidationError(`${field} must use YYYY-MM-DD format`);
  }
  return value;
}

/** @param {unknown} value @param {string} field */
function normalizeSource(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw new PopulationValidationError(
      `${field} must be a non-empty string up to 500 characters`,
    );
  }
  return value.trim();
}

/** @param {unknown} payload */
export function buildPopulationPlan(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PopulationValidationError('Request body must be a JSON object');
  }
  if (!Array.isArray(payload.populations) || payload.populations.length === 0) {
    throw new PopulationValidationError(
      'Request body must contain a non-empty populations array',
    );
  }

  const asOf = normalizeDate(payload.asOf, 'asOf');
  const source = normalizeSource(payload.source, 'source');

  const names = new Set();
  const populations = payload.populations.map((item, index) => {
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
    if (names.has(name)) {
      throw new PopulationValidationError(`Duplicate city: ${name}`);
    }
    names.add(name);

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

    return {
      name,
      population,
      asOf: item.asOf === undefined ? asOf : normalizeDate(item.asOf, `Population item ${index} asOf`),
      source: item.source === undefined ? source : normalizeSource(item.source, `Population item ${index} source`),
      attributes,
    };
  });

  return {
    asOf,
    source,
    populations,
  };
}
