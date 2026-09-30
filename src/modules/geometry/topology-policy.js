import {
  GeometryEditorValidationError,
  geometryFamily,
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

function normalizeGeometrySplitBladeRequest(
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

  const coordinates =
    blade.type ===
      'LineString'
      ? blade.coordinates
      : null;

  const distinctEndpoints =
    Array.isArray(
      coordinates,
    ) &&
    coordinates.length ===
      2 &&
    (
      coordinates[0][0] !==
        coordinates[1][0] ||
      coordinates[0][1] !==
        coordinates[1][1]
    );

  if (
    !distinctEndpoints
  ) {
    throw new GeometryEditorValidationError(
      'Split blade must be a two-point LineString with distinct endpoints',
    );
  }

  return blade;
}


export function normalizeGeometryCutPreviewRequest(
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
      'sourceGeometry',
      'cutterGeometry',
    ],
    'Cut preview request',
  );

  if (
    !Object.hasOwn(
      source,
      'sourceGeometry',
    ) ||
    !Object.hasOwn(
      source,
      'cutterGeometry',
    )
  ) {
    throw new GeometryEditorValidationError(
      'Cut preview requires sourceGeometry and cutterGeometry',
    );
  }

  const sourceGeometry =
    validateEditorGeometry(
      source.sourceGeometry,
    );
  const cutterGeometry =
    validateEditorGeometry(
      source.cutterGeometry,
    );

  if (
    geometryFamily(
      sourceGeometry,
    ) !==
    'polygon'
  ) {
    throw new GeometryEditorValidationError(
      'Cut preview source must be Polygon or MultiPolygon',
    );
  }

  if (
    geometryFamily(
      cutterGeometry,
    ) !==
    'polygon'
  ) {
    throw new GeometryEditorValidationError(
      'Cut preview cutter must be Polygon or MultiPolygon',
    );
  }

  return {
    sourceGeometry,
    cutterGeometry,
  };
}

export function normalizeGeometrySplitPreviewRequest(
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
      'sourceGeometry',
      'blade',
    ],
    'Split preview request',
  );

  if (
    !Object.hasOwn(
      source,
      'sourceGeometry',
    ) ||
    !Object.hasOwn(
      source,
      'blade',
    )
  ) {
    throw new GeometryEditorValidationError(
      'Split preview requires sourceGeometry and blade',
    );
  }

  const sourceGeometry =
    validateEditorGeometry(
      source.sourceGeometry,
    );
  const family =
    geometryFamily(
      sourceGeometry,
    );

  if (
    ![
      'line',
      'polygon',
    ].includes(
      family,
    )
  ) {
    throw new GeometryEditorValidationError(
      'Split preview source must be a line or polygon geometry',
    );
  }

  const blade =
    normalizeGeometrySplitBladeRequest({
      blade:
        source.blade,
    });

  return {
    sourceGeometry,
    blade,
    family,
  };
}
