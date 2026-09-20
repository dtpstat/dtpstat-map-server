const SUPPORTED_TYPES = new Map([
  ['Point', 'point'],
  ['LineString', 'line'],
  ['MultiLineString', 'line'],
  ['Polygon', 'polygon'],
  ['MultiPolygon', 'polygon'],
]);

export const GEOMETRY_FAMILIES = Object.freeze(['point', 'line', 'polygon']);

export class GeometryEditorValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'GeometryEditorValidationError';
    this.statusCode = statusCode;
  }
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GeometryEditorValidationError(`${label} must be an object`);
  }
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new GeometryEditorValidationError(`${label} must be a positive integer`);
  }
  return number;
}

function optionalText(value, label, maximum) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new GeometryEditorValidationError(`${label} must be a string or null`);
  }
  const normalized = value.trim().normalize('NFC');
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new GeometryEditorValidationError(`${label} must be at most ${maximum} characters`);
  }
  return normalized;
}

function position(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new GeometryEditorValidationError(`${label} must be a GeoJSON position`);
  }
  if (!value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))) {
    throw new GeometryEditorValidationError(`${label} contains a non-finite coordinate`);
  }
  if (value[0] < -180 || value[0] > 180 || value[1] < -90 || value[1] > 90) {
    throw new GeometryEditorValidationError(`${label} is outside WGS84 longitude/latitude bounds`);
  }
}

function line(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new GeometryEditorValidationError(`${label} must contain at least two positions`);
  }
  value.forEach((item, index) => position(item, `${label}[${index}]`));
}

function samePosition(left, right) {
  return left?.[0] === right?.[0] && left?.[1] === right?.[1];
}

function ring(value, label) {
  if (!Array.isArray(value) || value.length < 4) {
    throw new GeometryEditorValidationError(`${label} must contain at least four positions`);
  }
  value.forEach((item, index) => position(item, `${label}[${index}]`));
  if (!samePosition(value[0], value[value.length - 1])) {
    throw new GeometryEditorValidationError(`${label} must be closed`);
  }
}

function polygon(value, label) {
  if (!Array.isArray(value) || value.length < 1) {
    throw new GeometryEditorValidationError(`${label} must contain an exterior ring`);
  }
  value.forEach((item, index) => ring(item, `${label}[${index}]`));
}

export function geometryFamily(geometry) {
  const type = geometry?.type;
  return SUPPORTED_TYPES.get(type) ?? null;
}

export function validateEditorGeometry(value) {
  const geometry = object(value, 'geometry');
  const family = geometryFamily(geometry);
  if (!family) {
    throw new GeometryEditorValidationError(
      'geometry.type must be Point, LineString, MultiLineString, Polygon or MultiPolygon',
    );
  }
  const coordinates = geometry.coordinates;
  if (geometry.type === 'Point') position(coordinates, 'geometry.coordinates');
  else if (geometry.type === 'LineString') line(coordinates, 'geometry.coordinates');
  else if (geometry.type === 'MultiLineString') {
    if (!Array.isArray(coordinates) || coordinates.length < 1) {
      throw new GeometryEditorValidationError('MultiLineString must contain at least one line');
    }
    coordinates.forEach((item, index) => line(item, `geometry.coordinates[${index}]`));
  } else if (geometry.type === 'Polygon') {
    polygon(coordinates, 'geometry.coordinates');
  } else {
    if (!Array.isArray(coordinates) || coordinates.length < 1) {
      throw new GeometryEditorValidationError('MultiPolygon must contain at least one polygon');
    }
    coordinates.forEach((item, index) => polygon(item, `geometry.coordinates[${index}]`));
  }
  return { type: geometry.type, coordinates: structuredClone(coordinates) };
}

export function normalizeGeometryTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new GeometryEditorValidationError('tags must be an array with at most 64 values');
  }
  const result = [];
  const seen = new Set();
  for (const [index, raw] of value.entries()) {
    if (typeof raw !== 'string') {
      throw new GeometryEditorValidationError(`tags[${index}] must be a string`);
    }
    const tag = raw.trim().replace(/\s+/g, ' ').normalize('NFC');
    if (!tag || tag.length > 64) {
      throw new GeometryEditorValidationError(`tags[${index}] must contain 1-64 characters`);
    }
    const key = tag.toLocaleLowerCase('ru-RU');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

export function normalizeGeometryEditorPayload(payload, { creating = false } = {}) {
  const source = object(payload, 'Request body');
  const allowed = new Set([
    'cityId', 'geometry', 'displayName', 'tooltip', 'tags',
    'isVisible', 'lineTypeId', 'lanes',
  ]);
  const unknown = Object.keys(source).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new GeometryEditorValidationError(
      `Request body contains unsupported properties: ${unknown.join(', ')}`,
    );
  }

  const geometry = validateEditorGeometry(source.geometry);
  const family = geometryFamily(geometry);
  const isVisible = source.isVisible === undefined ? true : source.isVisible;
  if (typeof isVisible !== 'boolean') {
    throw new GeometryEditorValidationError('isVisible must be boolean');
  }

  let lineTypeId = null;
  let lanes = null;
  if (family === 'line') {
    lineTypeId = positiveInteger(source.lineTypeId, 'lineTypeId');
    lanes = Number(source.lanes);
    if (!Number.isInteger(lanes) || ![1, 2].includes(lanes)) {
      throw new GeometryEditorValidationError('lanes must be 1 or 2 for line geometries');
    }
  } else if (
    (source.lineTypeId !== undefined && source.lineTypeId !== null && source.lineTypeId !== '') ||
    (source.lanes !== undefined && source.lanes !== null && source.lanes !== '')
  ) {
    throw new GeometryEditorValidationError(
      'lineTypeId and lanes are allowed only for line geometries',
    );
  }

  return {
    ...(creating ? { cityId: positiveInteger(source.cityId, 'cityId') } : {}),
    geometry,
    family,
    displayName: optionalText(source.displayName, 'displayName', 240),
    tooltip: optionalText(source.tooltip, 'tooltip', 2000),
    tags: normalizeGeometryTags(source.tags),
    isVisible,
    lineTypeId,
    lanes,
  };
}

export function normalizeGeometryId(value, label = 'geometryId') {
  return positiveInteger(value, label);
}

export function normalizeGeometryIdList(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 200) {
    throw new GeometryEditorValidationError('ids must contain between 2 and 200 geometry ids');
  }
  const ids = [...new Set(value.map((item, index) => positiveInteger(item, `ids[${index}]`)))];
  if (ids.length < 2) {
    throw new GeometryEditorValidationError('ids must contain at least two distinct geometry ids');
  }
  return ids;
}
