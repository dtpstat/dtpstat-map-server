const SUPPORTED_TYPES = new Map([
  ['Point', 'point'],
  ['LineString', 'line'],
  ['MultiLineString', 'line'],
  ['Polygon', 'polygon'],
  ['MultiPolygon', 'polygon'],
]);

export const GEOMETRY_FAMILIES = Object.freeze([
  'point',
  'line',
  'polygon',
]);

export class GeometryEditorValidationError extends Error {
  constructor(
    message,
    statusCode = 400,
    details = null,
  ) {
    super(message);
    this.name =
      'GeometryEditorValidationError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function object(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new GeometryEditorValidationError(
      `${label} must be an object`,
    );
  }
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new GeometryEditorValidationError(
      `${label} must be a positive integer`,
    );
  }
  return number;
}

function optionalText(
  value,
  label,
  maximum,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new GeometryEditorValidationError(
      `${label} must be a string or null`,
    );
  }
  const normalized =
    value.trim().normalize('NFC');
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new GeometryEditorValidationError(
      `${label} must be at most ${maximum} characters`,
    );
  }
  return normalized;
}

function position(value, label) {
  if (
    !Array.isArray(value) ||
    value.length < 2
  ) {
    throw new GeometryEditorValidationError(
      `${label} must be a GeoJSON position`,
    );
  }
  if (
    !value.every(
      (coordinate) =>
        typeof coordinate === 'number' &&
        Number.isFinite(coordinate),
    )
  ) {
    throw new GeometryEditorValidationError(
      `${label} contains a non-finite coordinate`,
    );
  }
  if (
    value[0] < -180 ||
    value[0] > 180 ||
    value[1] < -90 ||
    value[1] > 90
  ) {
    throw new GeometryEditorValidationError(
      `${label} is outside WGS84 longitude/latitude bounds`,
    );
  }
}

function line(value, label) {
  if (
    !Array.isArray(value) ||
    value.length < 2
  ) {
    throw new GeometryEditorValidationError(
      `${label} must contain at least two positions`,
    );
  }
  value.forEach(
    (item, index) =>
      position(
        item,
        `${label}[${index}]`,
      ),
  );
}

function samePosition(left, right) {
  return (
    left?.[0] === right?.[0] &&
    left?.[1] === right?.[1]
  );
}

function ring(value, label) {
  if (
    !Array.isArray(value) ||
    value.length < 4
  ) {
    throw new GeometryEditorValidationError(
      `${label} must contain at least four positions`,
    );
  }
  value.forEach(
    (item, index) =>
      position(
        item,
        `${label}[${index}]`,
      ),
  );
  if (
    !samePosition(
      value[0],
      value[value.length - 1],
    )
  ) {
    throw new GeometryEditorValidationError(
      `${label} must be closed`,
    );
  }
}

function polygon(value, label) {
  if (
    !Array.isArray(value) ||
    value.length < 1
  ) {
    throw new GeometryEditorValidationError(
      `${label} must contain an exterior ring`,
    );
  }
  value.forEach(
    (item, index) =>
      ring(
        item,
        `${label}[${index}]`,
      ),
  );
}

export function geometryFamily(geometry) {
  return (
    SUPPORTED_TYPES.get(
      geometry?.type,
    ) ??
    null
  );
}

export function validateEditorGeometry(
  value,
) {
  const geometry =
    object(value, 'geometry');
  const family =
    geometryFamily(geometry);

  if (!family) {
    throw new GeometryEditorValidationError(
      'geometry.type must be Point, LineString, MultiLineString, Polygon or MultiPolygon',
    );
  }

  const coordinates =
    geometry.coordinates;

  if (geometry.type === 'Point') {
    position(
      coordinates,
      'geometry.coordinates',
    );
  } else if (
    geometry.type ===
    'LineString'
  ) {
    line(
      coordinates,
      'geometry.coordinates',
    );
  } else if (
    geometry.type ===
    'MultiLineString'
  ) {
    if (
      !Array.isArray(coordinates) ||
      coordinates.length < 1
    ) {
      throw new GeometryEditorValidationError(
        'MultiLineString must contain at least one line',
      );
    }
    coordinates.forEach(
      (item, index) =>
        line(
          item,
          `geometry.coordinates[${index}]`,
        ),
    );
  } else if (
    geometry.type === 'Polygon'
  ) {
    polygon(
      coordinates,
      'geometry.coordinates',
    );
  } else {
    if (
      !Array.isArray(coordinates) ||
      coordinates.length < 1
    ) {
      throw new GeometryEditorValidationError(
        'MultiPolygon must contain at least one polygon',
      );
    }
    coordinates.forEach(
      (item, index) =>
        polygon(
          item,
          `geometry.coordinates[${index}]`,
        ),
    );
  }

  return {
    type: geometry.type,
    coordinates:
      structuredClone(coordinates),
  };
}

export function normalizeGeometryTags(
  value,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    value.length > 64
  ) {
    throw new GeometryEditorValidationError(
      'tags must be an array with at most 64 values',
    );
  }

  const result = [];
  const seen = new Set();

  for (
    const [index, raw] of
    value.entries()
  ) {
    if (typeof raw !== 'string') {
      throw new GeometryEditorValidationError(
        `tags[${index}] must be a string`,
      );
    }

    const tag =
      raw
        .trim()
        .replace(/\s+/gu, ' ')
        .normalize('NFC');

    if (
      !tag ||
      tag.length > 64
    ) {
      throw new GeometryEditorValidationError(
        `tags[${index}] must contain 1-64 characters`,
      );
    }

    const key =
      tag.toLocaleLowerCase(
        'ru-RU',
      );
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }

  return result;
}

function normalizedLineTypeId(
  value,
) {
  if (
    value === null ||
    value === ''
  ) {
    return null;
  }
  return positiveInteger(
    value,
    'lineTypeId',
  );
}

function normalizedLanes(value) {
  if (
    value === null ||
    value === ''
  ) {
    return null;
  }
  const lanes = Number(value);
  if (
    !Number.isInteger(lanes) ||
    ![1, 2].includes(lanes)
  ) {
    throw new GeometryEditorValidationError(
      'lanes must be 1 or 2',
    );
  }
  return lanes;
}

export function validateGeometryLineState(
  geometry,
  lineTypeId,
  lanes,
) {
  const family =
    geometryFamily(geometry);

  if (family === 'line') {
    if (
      !Number.isSafeInteger(
        lineTypeId,
      ) ||
      lineTypeId <= 0
    ) {
      throw new GeometryEditorValidationError(
        'lineTypeId is required for line geometries',
      );
    }
    if (
      !Number.isInteger(lanes) ||
      ![1, 2].includes(lanes)
    ) {
      throw new GeometryEditorValidationError(
        'lanes must be 1 or 2 for line geometries',
      );
    }
  } else if (
    lineTypeId !== null ||
    lanes !== null
  ) {
    throw new GeometryEditorValidationError(
      'lineTypeId and lanes are allowed only for line geometries',
    );
  }

  return family;
}

export function normalizeGeometryChanges(
  payload,
) {
  const source =
    object(
      payload,
      'geometry changes',
    );

  const allowed =
    new Set([
      'geometry',
      'displayName',
      'tooltip',
      'tags',
      'isVisible',
      'lineTypeId',
      'lanes',
    ]);

  const unknown =
    Object.keys(source)
      .filter(
        (key) =>
          !allowed.has(key),
      );

  if (unknown.length > 0) {
    throw new GeometryEditorValidationError(
      'Unsupported geometry fields: ' +
        unknown.join(', '),
    );
  }

  const result = {};

  if ('geometry' in source) {
    result.geometry =
      validateEditorGeometry(
        source.geometry,
      );
  }
  if ('displayName' in source) {
    result.displayName =
      optionalText(
        source.displayName,
        'displayName',
        240,
      );
  }
  if ('tooltip' in source) {
    result.tooltip =
      optionalText(
        source.tooltip,
        'tooltip',
        2000,
      );
  }
  if ('tags' in source) {
    result.tags =
      normalizeGeometryTags(
        source.tags,
      );
  }
  if ('isVisible' in source) {
    if (
      typeof source.isVisible !==
      'boolean'
    ) {
      throw new GeometryEditorValidationError(
        'isVisible must be boolean',
      );
    }
    result.isVisible =
      source.isVisible;
  }
  if ('lineTypeId' in source) {
    result.lineTypeId =
      normalizedLineTypeId(
        source.lineTypeId,
      );
  }
  if ('lanes' in source) {
    result.lanes =
      normalizedLanes(
        source.lanes,
      );
  }

  if (
    Object.keys(result).length === 0
  ) {
    throw new GeometryEditorValidationError(
      'No geometry changes supplied',
    );
  }

  return result;
}

export function normalizeGeometryCreatePayload(
  payload,
) {
  const source =
    object(
      payload,
      'Request body',
    );

  const allowed =
    new Set([
      'cityId',
      'geometry',
      'displayName',
      'tooltip',
      'tags',
      'isVisible',
      'lineTypeId',
      'lanes',
    ]);

  const unknown =
    Object.keys(source)
      .filter(
        (key) =>
          !allowed.has(key),
      );

  if (unknown.length > 0) {
    throw new GeometryEditorValidationError(
      'Request body contains unsupported properties: ' +
        unknown.join(', '),
    );
  }

  if (!('geometry' in source)) {
    throw new GeometryEditorValidationError(
      'geometry is required',
    );
  }

  const changes =
    normalizeGeometryChanges(
      Object.fromEntries(
        Object.entries(source)
          .filter(
            ([key]) =>
              key !== 'cityId',
          ),
      ),
    );

  const value = {
    cityId:
      positiveInteger(
        source.cityId,
        'cityId',
      ),
    geometry:
      changes.geometry,
    displayName:
      changes.displayName ??
      null,
    tooltip:
      changes.tooltip ??
      null,
    tags:
      changes.tags ??
      [],
    isVisible:
      changes.isVisible ??
      true,
    lineTypeId:
      changes.lineTypeId ??
      null,
    lanes:
      changes.lanes ??
      null,
  };

  value.family =
    validateGeometryLineState(
      value.geometry,
      value.lineTypeId,
      value.lanes,
    );

  return value;
}

export function normalizeGeometryId(
  value,
  label = 'geometryId',
) {
  return positiveInteger(
    value,
    label,
  );
}

export function normalizeGeometryRevision(
  value,
) {
  if (
    typeof value !== 'string' ||
    !value.trim()
  ) {
    throw new GeometryEditorValidationError(
      'baseUpdatedAt must be an ISO timestamp',
    );
  }

  const date =
    new Date(value);
  if (
    Number.isNaN(
      date.valueOf(),
    )
  ) {
    throw new GeometryEditorValidationError(
      'baseUpdatedAt must be an ISO timestamp',
    );
  }

  return date.toISOString();
}

export function normalizeGeometryBulkUpdates(
  payload,
) {
  const source =
    object(
      payload,
      'Request body',
    );

  const unknown =
    Object.keys(source)
      .filter(
        (key) =>
          key !== 'updates',
      );

  if (unknown.length > 0) {
    throw new GeometryEditorValidationError(
      'Unsupported bulk update fields: ' +
        unknown.join(', '),
    );
  }

  if (
    !Array.isArray(
      source.updates,
    ) ||
    source.updates.length < 1 ||
    source.updates.length > 500
  ) {
    throw new GeometryEditorValidationError(
      'updates must contain 1-500 items',
    );
  }

  const seen = new Set();

  return source.updates.map(
    (entry, index) => {
      object(
        entry,
        `updates[${index}]`,
      );

      const entryUnknown =
        Object.keys(entry)
          .filter(
            (key) =>
              ![
                'id',
                'baseUpdatedAt',
                'changes',
              ].includes(key),
          );

      if (
        entryUnknown.length > 0
      ) {
        throw new GeometryEditorValidationError(
          `updates[${index}] contains unsupported fields: ` +
            entryUnknown.join(', '),
        );
      }

      const id =
        normalizeGeometryId(
          entry.id,
        );

      if (seen.has(id)) {
        throw new GeometryEditorValidationError(
          `Duplicate geometry id in bulk update: ${id}`,
        );
      }
      seen.add(id);

      return {
        id,
        baseUpdatedAt:
          normalizeGeometryRevision(
            entry.baseUpdatedAt,
          ),
        changes:
          normalizeGeometryChanges(
            entry.changes,
          ),
      };
    },
  );
}
