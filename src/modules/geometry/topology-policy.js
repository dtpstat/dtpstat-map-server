import {
  GeometryEditorValidationError,
  geometryFamily,
  normalizeGeometryId,
  normalizeGeometryRevision,
  validateEditorGeometry,
} from './editor-policy.js';

function requestObject(
  value,
  label,
) {
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

function unsupportedFields(
  source,
  allowed,
  label,
) {
  const unknown =
    Object.keys(source)
      .filter(
        (key) =>
          !allowed.includes(key),
      );

  if (unknown.length > 0) {
    throw new GeometryEditorValidationError(
      `${label} contains unsupported fields: ` +
        unknown.join(', '),
    );
  }
}

export function normalizeGeometryCutRequest(
  payload,
) {
  const source =
    requestObject(
      payload,
      'Request body',
    );

  unsupportedFields(
    source,
    [
      'geometry',
      'cutterGeometryId',
      'cutterUpdatedAt',
    ],
    'Cut request',
  );

  const hasInline =
    Object.hasOwn(
      source,
      'geometry',
    );

  const hasReferenced =
    Object.hasOwn(
      source,
      'cutterGeometryId',
    ) ||
    Object.hasOwn(
      source,
      'cutterUpdatedAt',
    );

  if (
    hasInline ===
    hasReferenced
  ) {
    throw new GeometryEditorValidationError(
      'Cut request must contain exactly one cutter source',
    );
  }

  if (hasInline) {
    const geometry =
      validateEditorGeometry(
        source.geometry,
      );

    if (
      geometryFamily(
        geometry,
      ) !==
      'polygon'
    ) {
      throw new GeometryEditorValidationError(
        'Cut geometry must be Polygon or MultiPolygon',
      );
    }

    return {
      kind:
        'inline',
      geometry,
    };
  }

  if (
    !Object.hasOwn(
      source,
      'cutterGeometryId',
    ) ||
    !Object.hasOwn(
      source,
      'cutterUpdatedAt',
    )
  ) {
    throw new GeometryEditorValidationError(
      'Referenced cutter requires cutterGeometryId and cutterUpdatedAt',
    );
  }

  return {
    kind:
      'geometry',
    geometryId:
      normalizeGeometryId(
        source
          .cutterGeometryId,
        'cutterGeometryId',
      ),
    baseUpdatedAt:
      normalizeGeometryRevision(
        source
          .cutterUpdatedAt,
      ),
  };
}

export function normalizeGeometrySplitRequest(
  payload,
) {
  const source =
    requestObject(
      payload,
      'Request body',
    );

  unsupportedFields(
    source,
    ['blade'],
    'Split request',
  );

  if (
    !Object.hasOwn(
      source,
      'blade',
    )
  ) {
    throw new GeometryEditorValidationError(
      'blade is required',
    );
  }

  const blade =
    validateEditorGeometry(
      source.blade,
    );

  if (
    geometryFamily(
      blade,
    ) !==
    'line'
  ) {
    throw new GeometryEditorValidationError(
      'Split blade must be LineString or MultiLineString',
    );
  }

  return blade;
}
