export class PointTypeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name =
      'PointTypeValidationError';
  }
}

function object(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new PointTypeValidationError(
      `${label} must be an object`,
    );
  }
  return value;
}

function id(value) {
  const number = Number(value);
  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new PointTypeValidationError(
      'pointTypeId must be a positive integer',
    );
  }
  return number;
}

function name(value) {
  if (typeof value !== 'string') {
    throw new PointTypeValidationError(
      'name must be a string',
    );
  }
  const normalized =
    value
      .trim()
      .replace(/\s+/gu, ' ')
      .normalize('NFC');
  if (
    !normalized ||
    normalized.length > 120
  ) {
    throw new PointTypeValidationError(
      'name must contain 1-120 characters',
    );
  }
  return normalized;
}

function size(value, label) {
  const number = Number(value);
  if (
    !Number.isInteger(number) ||
    number < 8 ||
    number > 256
  ) {
    throw new PointTypeValidationError(
      `${label} must be an integer from 8 to 256`,
    );
  }
  return number;
}

function anchor(
  value,
  label,
  maximum,
) {
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < 0 ||
    number > maximum
  ) {
    throw new PointTypeValidationError(
      `${label} must be between 0 and ${maximum}`,
    );
  }
  return number;
}

export function normalizePointTypeId(value) {
  return id(value);
}

export function normalizePointTypeCreate(payload) {
  const source =
    object(
      payload,
      'Request body',
    );
  const allowed =
    new Set([
      'name',
      'isActive',
      'displayWidth',
      'displayHeight',
      'anchorX',
      'anchorY',
    ]);
  const unknown =
    Object.keys(source)
      .filter(
        (key) =>
          !allowed.has(key),
      );
  if (unknown.length > 0) {
    throw new PointTypeValidationError(
      'Unsupported point type fields: ' +
        unknown.join(', '),
    );
  }

  const displayWidth =
    source.displayWidth ===
      undefined
      ? 32
      : size(
        source.displayWidth,
        'displayWidth',
      );
  const displayHeight =
    source.displayHeight ===
      undefined
      ? 32
      : size(
        source.displayHeight,
        'displayHeight',
      );

  if (
    source.isActive !==
      undefined &&
    typeof source.isActive !==
      'boolean'
  ) {
    throw new PointTypeValidationError(
      'isActive must be boolean',
    );
  }

  return {
    name:
      name(source.name),
    isActive:
      source.isActive ??
      true,
    displayWidth,
    displayHeight,
    anchorX:
      source.anchorX ===
        undefined
        ? displayWidth / 2
        : anchor(
          source.anchorX,
          'anchorX',
          displayWidth,
        ),
    anchorY:
      source.anchorY ===
        undefined
        ? displayHeight / 2
        : anchor(
          source.anchorY,
          'anchorY',
          displayHeight,
        ),
  };
}

export function normalizePointTypeUpdate(
  payload,
  current,
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
          ![
            'name',
            'isActive',
            'displayWidth',
            'displayHeight',
            'anchorX',
            'anchorY',
          ].includes(key),
      );
  if (unknown.length > 0) {
    throw new PointTypeValidationError(
      'Unsupported point type fields: ' +
        unknown.join(', '),
    );
  }
  if (
    Object.keys(source).length ===
    0
  ) {
    throw new PointTypeValidationError(
      'No point type changes supplied',
    );
  }

  const next = {
    name:
      'name' in source
        ? name(source.name)
        : current.name,
    isActive:
      'isActive' in source
        ? source.isActive
        : current.isActive,
    displayWidth:
      'displayWidth' in source
        ? size(
          source.displayWidth,
          'displayWidth',
        )
        : current.displayWidth,
    displayHeight:
      'displayHeight' in source
        ? size(
          source.displayHeight,
          'displayHeight',
        )
        : current.displayHeight,
    anchorX:
      'anchorX' in source
        ? Number(source.anchorX)
        : current.anchorX,
    anchorY:
      'anchorY' in source
        ? Number(source.anchorY)
        : current.anchorY,
  };

  if (
    typeof next.isActive !==
    'boolean'
  ) {
    throw new PointTypeValidationError(
      'isActive must be boolean',
    );
  }

  next.anchorX =
    anchor(
      next.anchorX,
      'anchorX',
      next.displayWidth,
    );
  next.anchorY =
    anchor(
      next.anchorY,
      'anchorY',
      next.displayHeight,
    );

  return next;
}
