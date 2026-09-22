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

function normalizeOsmType(value, field) {
  if (!['way', 'relation'].includes(value)) {
    throw new PopulationValidationError(
      `${field} must be way or relation`,
    );
  }
  return value;
}

function normalizeOsmId(value, field) {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new PopulationValidationError(
      `${field} must be a positive OSM integer identifier`,
    );
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number)) {
    throw new PopulationValidationError(
      `${field} exceeds the supported safe integer range`,
    );
  }
  return text;
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PopulationValidationError(
      `${field} must be a JSON object`,
    );
  }
  return value;
}

function normalizeOptionalAdminLevel(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const level = Number(value);
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new PopulationValidationError(
      `${field} must be an integer between 1 and 20 or null`,
    );
  }
  return level;
}

function normalizeOptionalPlaceType(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (!['city', 'town'].includes(value)) {
    throw new PopulationValidationError(
      `${field} must be city, town or null`,
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

function identity(osmType, osmId) {
  return `${osmType}/${osmId}`;
}

function normalizeTerritory(
  raw,
  path,
  defaults,
  parent,
  seen,
  rows,
  limits,
) {
  const item = object(raw, `Territory ${path}`);
  const allowed = new Set([
    'osmType',
    'osmId',
    'name',
    'type',
    'placeType',
    'adminLevel',
    'population',
    'asOf',
    'source',
    'attributes',
    'children',
  ]);
  const unknown = Object.keys(item).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new PopulationValidationError(
      `Territory ${path} contains unsupported properties: ${unknown.join(', ')}`,
    );
  }

  const osmType = normalizeOsmType(
    item.osmType,
    `Territory ${path} osmType`,
  );
  const osmId = normalizeOsmId(
    item.osmId,
    `Territory ${path} osmId`,
  );
  const key = identity(osmType, osmId);
  if (seen.has(key)) {
    throw new PopulationValidationError(
      `Duplicate OSM territory identity: ${key}`,
    );
  }
  seen.add(key);

  if (!Object.hasOwn(item, 'population')) {
    throw new PopulationValidationError(
      `Territory ${path} must contain population (integer or null)`,
    );
  }
  if (!Object.hasOwn(item, 'attributes')) {
    throw new PopulationValidationError(
      `Territory ${path} must contain attributes`,
    );
  }

  const row = {
    osmType,
    osmId,
    name: normalizeText(item.name, `Territory ${path} name`),
    type: normalizeText(item.type, `Territory ${path} type`, 80),
    placeType: normalizeOptionalPlaceType(
      item.placeType,
      `Territory ${path} placeType`,
    ),
    adminLevel: normalizeOptionalAdminLevel(
      item.adminLevel,
      `Territory ${path} adminLevel`,
    ),
    population: normalizePopulation(
      item.population,
      `Territory ${path} population`,
    ),
    asOf: item.asOf === undefined
      ? defaults.asOf
      : normalizeDate(item.asOf, `Territory ${path} asOf`),
    source: item.source === undefined
      ? defaults.source
      : normalizeSource(item.source, `Territory ${path} source`),
    attributes: normalizeAttributes(
      item.attributes,
      `Territory ${path} attributes`,
    ),
    parentOsmType: parent?.osmType ?? null,
    parentOsmId: parent?.osmId ?? null,
  };

  rows.push(row);
  if (rows.length > limits.maxItems) {
    throw new PopulationValidationError(
      `Population hierarchy contains more than ${limits.maxItems} territories`,
    );
  }

  const children = item.children ?? [];
  if (!Array.isArray(children)) {
    throw new PopulationValidationError(
      `Territory ${path} children must be an array`,
    );
  }
  for (const [index, child] of children.entries()) {
    normalizeTerritory(
      child,
      `${path}.children[${index}]`,
      defaults,
      row,
      seen,
      rows,
      limits,
    );
  }
}

export function createPopulationHierarchyAccumulator({
  asOf: rawAsOf,
  source: rawSource,
  maxItems = 5_000_000,
  collectTerritories = false,
} = {}) {
  const defaults = {
    asOf: normalizeDate(rawAsOf, 'asOf'),
    source: normalizeSource(rawSource, 'source'),
  };
  const seen = new Set();
  const collected = collectTerritories ? [] : null;
  let territoryCount = 0;
  let rootCount = 0;

  return {
    addRoot(root, rootIndex = rootCount) {
      const rows = [];
      normalizeTerritory(
        root,
        `territories[${rootIndex}]`,
        defaults,
        null,
        seen,
        rows,
        { maxItems: maxItems - territoryCount },
      );
      territoryCount += rows.length;
      rootCount += 1;
      collected?.push(...rows);
      return rows;
    },

    finish(metadata = {}) {
      normalizeSchemaVersion(metadata.schemaVersion);
      if (rootCount === 0 || territoryCount === 0) {
        throw new PopulationValidationError(
          'Request body must contain a non-empty territories array',
        );
      }
      return {
        schemaVersion: 2,
        asOf: defaults.asOf,
        source: defaults.source,
        rootCount,
        territoryCount,
        territories: collected ?? [],
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
  if (!Array.isArray(payload.territories)) {
    throw new PopulationValidationError(
      'Request body must contain a non-empty territories array',
    );
  }

  const accumulator = createPopulationHierarchyAccumulator({
    asOf: payload.asOf,
    source: payload.source,
    maxItems: options.maxItems,
    collectTerritories: true,
  });
  for (const [index, root] of payload.territories.entries()) {
    accumulator.addRoot(root, index);
  }
  return accumulator.finish({ schemaVersion: payload.schemaVersion });
}
