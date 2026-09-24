export class OsmBoundaryAdminValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'OsmBoundaryAdminValidationError';
    this.statusCode = statusCode;
  }
}

function normalizedText(value, name, max = 160) {
  if (typeof value !== 'string') {
    throw new OsmBoundaryAdminValidationError(
      `${name} must be a string`,
    );
  }
  const normalized = value.trim().normalize('NFC');
  if (!normalized || normalized.length > max) {
    throw new OsmBoundaryAdminValidationError(
      `${name} must contain 1-${max} characters`,
    );
  }
  return normalized;
}

function nullableText(value, name, max = 500) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return normalizedText(value, name, max);
}

function nullableDate(value, name) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw new OsmBoundaryAdminValidationError(
      `${name} must use YYYY-MM-DD format or null`,
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new OsmBoundaryAdminValidationError(
      `${name} must be a valid calendar date or null`,
    );
  }
  return value;
}

function attributesObject(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new OsmBoundaryAdminValidationError(
      'attributes must be a JSON object',
    );
  }
  return value;
}

export function normalizeOsmBoundaryChanges(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new OsmBoundaryAdminValidationError(
      'Request body must be an object',
    );
  }

  const allowed = new Set([
    'active',
    'displayName',
    'displayType',
    'population',
    'populationAsOf',
    'populationSource',
    'attributes',
  ]);
  const unknown = Object.keys(value)
    .filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new OsmBoundaryAdminValidationError(
      'Unsupported OSM boundary fields: ' +
        unknown.join(', '),
    );
  }

  const result = {};
  if ('active' in value) {
    if (typeof value.active !== 'boolean') {
      throw new OsmBoundaryAdminValidationError(
        'active must be boolean',
      );
    }
    result.active = value.active;
  }

  if ('displayName' in value) {
    result.displayName = normalizedText(
      value.displayName,
      'displayName',
    );
  }

  if ('displayType' in value) {
    result.displayType = normalizedText(
      value.displayType,
      'displayType',
      80,
    );
  }

  if ('population' in value) {
    if (value.population === null || value.population === '') {
      result.population = null;
    } else {
      const population = Number(value.population);
      if (
        !Number.isSafeInteger(population) ||
        population <= 0 ||
        population > 2147483647
      ) {
        throw new OsmBoundaryAdminValidationError(
          'population must be a positive integer up to ' +
            '2147483647 or null',
        );
      }
      result.population = population;
    }
  }

  if ('populationAsOf' in value) {
    result.populationAsOf = nullableDate(
      value.populationAsOf,
      'populationAsOf',
    );
  }

  if ('populationSource' in value) {
    result.populationSource = nullableText(
      value.populationSource,
      'populationSource',
    );
  }

  if ('attributes' in value) {
    result.attributes = attributesObject(
      value.attributes,
    );
  }

  if (Object.keys(result).length === 0) {
    throw new OsmBoundaryAdminValidationError(
      'No OSM boundary changes supplied',
    );
  }

  return result;
}

export function normalizeOsmBoundaryId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new OsmBoundaryAdminValidationError(
      'boundaryId must be a positive integer',
    );
  }
  return id;
}

export function normalizeOsmSubtreeActive(value) {
  if (typeof value !== 'boolean') {
    throw new OsmBoundaryAdminValidationError(
      'active must be boolean',
    );
  }
  return value;
}
