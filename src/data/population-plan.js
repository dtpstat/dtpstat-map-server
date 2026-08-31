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

  const asOf = payload.asOf ?? null;
  if (asOf !== null && (typeof asOf !== 'string' || !validDate(asOf))) {
    throw new PopulationValidationError('asOf must use YYYY-MM-DD format');
  }
  const source = payload.source ?? null;
  if (
    source !== null &&
    (typeof source !== 'string' || !source.trim() || source.length > 500)
  ) {
    throw new PopulationValidationError(
      'source must be a non-empty string up to 500 characters',
    );
  }

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

    return { name, population, attributes };
  });

  return {
    asOf,
    source: source?.trim() ?? null,
    populations,
  };
}
