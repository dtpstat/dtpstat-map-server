export const DEFAULT_LINE_TYPE = 'default';
export const LINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted']);

export class LineTypeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LineTypeValidationError';
  }
}

/** @param {unknown} value @param {string} label */
export function normalizeLineTypeCode(value, label = 'type') {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_LINE_TYPE;
  }
  if (typeof value !== 'string') {
    throw new LineTypeValidationError(`${label} must be a string`);
  }
  const code = value.trim().normalize('NFC');
  if (!code || code.length > 64 || /[\u0000-\u001f\u007f]/u.test(code)) {
    throw new LineTypeValidationError(
      `${label} must be a non-empty string up to 64 characters`,
    );
  }
  return code;
}

/** @param {unknown} value @param {string} label */
function normalizedName(value, label) {
  if (typeof value !== 'string') {
    throw new LineTypeValidationError(`${label} must be a string`);
  }
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 120) {
    throw new LineTypeValidationError(
      `${label} must be a non-empty string up to 120 characters`,
    );
  }
  return name;
}

/** @param {string} value */
function comparableName(value) {
  return value.toLowerCase();
}

/** @param {unknown} value @param {string} label */
function normalizedColor(value, label) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    throw new LineTypeValidationError(`${label} must use #RRGGBB format`);
  }
  return value.trim().toLowerCase();
}

/** @param {unknown} value @param {string} label */
function normalizedStyle(value, label) {
  if (typeof value !== 'string' || !LINE_STYLES.includes(value)) {
    throw new LineTypeValidationError(
      `${label} must be one of: ${LINE_STYLES.join(', ')}`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function normalizedWidth(value, label) {
  const width = Number(value);
  if (!Number.isFinite(width) || width < 0.5 || width > 32) {
    throw new LineTypeValidationError(`${label} must be between 0.5 and 32`);
  }
  return width;
}

/** @param {unknown} payload */
export function buildLineTypesPlan(payload) {
  const rawTypes = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload.lineTypes
      : null;
  if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
    throw new LineTypeValidationError('lineTypes must be a non-empty array');
  }

  const seen = new Set();
  const seenNames = new Map();
  const lineTypes = rawTypes.map((rawType, index) => {
    if (!rawType || typeof rawType !== 'object' || Array.isArray(rawType)) {
      throw new LineTypeValidationError(`lineTypes[${index}] must be an object`);
    }
    const unknown = Object.keys(rawType).filter(
      (key) => !['type', 'name', 'color', 'style', 'width'].includes(key),
    );
    if (unknown.length > 0) {
      throw new LineTypeValidationError(
        `lineTypes[${index}] contains unsupported properties: ${unknown.join(', ')}`,
      );
    }
    const type = normalizeLineTypeCode(rawType.type, `lineTypes[${index}].type`);
    if (seen.has(type)) {
      throw new LineTypeValidationError(`Duplicate line type: ${type}`);
    }
    seen.add(type);

    const name = normalizedName(rawType.name, `lineTypes[${index}].name`);
    const normalizedNameKey = comparableName(name);
    if (seenNames.has(normalizedNameKey)) {
      throw new LineTypeValidationError(
        `Duplicate line type name ignoring case: ${name}`,
      );
    }
    seenNames.set(normalizedNameKey, type);

    return {
      type,
      name,
      color: normalizedColor(rawType.color, `lineTypes[${index}].color`),
      style: normalizedStyle(rawType.style, `lineTypes[${index}].style`),
      width: normalizedWidth(rawType.width, `lineTypes[${index}].width`),
    };
  });

  if (!seen.has(DEFAULT_LINE_TYPE)) {
    throw new LineTypeValidationError('lineTypes must contain the default type');
  }

  return { lineTypes };
}
