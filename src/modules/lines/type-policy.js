export const DEFAULT_LINE_TYPE_CODE = 0;
export const DEFAULT_LINE_TYPE_NAME = 'default';
export const LINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted']);

export class LineTypeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LineTypeValidationError';
  }
}

/** @param {unknown} value @param {string} label */
export function normalizeLineTypeCode(value, label = 'code') {
  const code = Number(value);
  if (!Number.isSafeInteger(code) || code < 0 || code > 2147483647) {
    throw new LineTypeValidationError(
      `${label} must be an integer between 0 and 2147483647`,
    );
  }
  return code;
}

/** @param {unknown} value @param {string} label */
export function normalizeLineTypeName(value, label = 'name') {
  if (typeof value !== 'string') {
    throw new LineTypeValidationError(`${label} must be a string`);
  }
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new LineTypeValidationError(
      `${label} must be a non-empty string up to 120 characters`,
    );
  }
  return name;
}

/** @param {unknown} value @param {string} label */
export function normalizeLineTypeTitle(value, label = 'title') {
  return normalizeLineTypeName(value, label);
}

/** @param {string} value */
export function comparableLineTypeName(value) {
  return value.trim().normalize('NFC').toLocaleLowerCase('ru-RU');
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

/**
 * Validate a portable line type dictionary. CODE is only a compact reference
 * inside the transferred snapshot. On import the destination database resolves
 * entries by NAME and generates its own CODE for newly created types.
 *
 * Legacy v2 entries ({type, name, ...}) are accepted and translated as:
 *   legacy type -> imported NAME
 *   legacy name -> TITLE
 *
 * @param {unknown} payload
 */
export function buildLineTypesPlan(payload) {
  const rawTypes = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload.lineTypes
      : null;
  if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
    throw new LineTypeValidationError('lineTypes must be a non-empty array');
  }

  const seenCodes = new Set();
  const seenNames = new Set();
  const lineTypes = rawTypes.map((rawType, index) => {
    if (!rawType || typeof rawType !== 'object' || Array.isArray(rawType)) {
      throw new LineTypeValidationError(`lineTypes[${index}] must be an object`);
    }

    const legacy = rawType.code === undefined && rawType.type !== undefined;
    const allowed = legacy
      ? ['type', 'name', 'color', 'style', 'width']
      : ['code', 'name', 'title', 'color', 'style', 'width'];
    const unknown = Object.keys(rawType).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
      throw new LineTypeValidationError(
        `lineTypes[${index}] contains unsupported properties: ${unknown.join(', ')}`,
      );
    }

    let code;
    let name;
    let title;
    if (legacy) {
      const legacyName = normalizeLineTypeName(
        rawType.type,
        `lineTypes[${index}].type`,
      );
      code = index;
      name = legacyName;
      title = normalizeLineTypeTitle(
        rawType.name ?? legacyName,
        `lineTypes[${index}].name`,
      );
    } else {
      code = normalizeLineTypeCode(rawType.code, `lineTypes[${index}].code`);
      name = normalizeLineTypeName(rawType.name, `lineTypes[${index}].name`);
      title = normalizeLineTypeTitle(
        rawType.title ?? name,
        `lineTypes[${index}].title`,
      );
    }

    if (seenCodes.has(code)) {
      throw new LineTypeValidationError(`Duplicate line type code: ${code}`);
    }
    seenCodes.add(code);

    const nameKey = comparableLineTypeName(name);
    if (seenNames.has(nameKey)) {
      throw new LineTypeValidationError(
        `Duplicate line type name ignoring case: ${name}`,
      );
    }
    seenNames.add(nameKey);

    return {
      code,
      name,
      title,
      color: normalizedColor(rawType.color, `lineTypes[${index}].color`),
      style: normalizedStyle(rawType.style, `lineTypes[${index}].style`),
      width: normalizedWidth(rawType.width, `lineTypes[${index}].width`),
    };
  });

  return { lineTypes };
}

/**
 * Validate editable admin settings. NAME and CODE are intentionally absent:
 * imports own NAME and the database owns CODE.
 *
 * @param {unknown} payload
 */
export function buildLineTypeSettingsPlan(payload) {
  const rawTypes = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload.lineTypes
    : null;
  if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
    throw new LineTypeValidationError('lineTypes must be a non-empty array');
  }

  const seenCodes = new Set();
  const lineTypes = rawTypes.map((rawType, index) => {
    if (!rawType || typeof rawType !== 'object' || Array.isArray(rawType)) {
      throw new LineTypeValidationError(`lineTypes[${index}] must be an object`);
    }
    const unknown = Object.keys(rawType).filter(
      (key) => !['code', 'title', 'color', 'style', 'width'].includes(key),
    );
    if (unknown.length > 0) {
      throw new LineTypeValidationError(
        `lineTypes[${index}] contains unsupported properties: ${unknown.join(', ')}`,
      );
    }

    const code = normalizeLineTypeCode(rawType.code, `lineTypes[${index}].code`);
    if (seenCodes.has(code)) {
      throw new LineTypeValidationError(`Duplicate line type code: ${code}`);
    }
    seenCodes.add(code);

    return {
      code,
      title: normalizeLineTypeTitle(rawType.title, `lineTypes[${index}].title`),
      color: normalizedColor(rawType.color, `lineTypes[${index}].color`),
      style: normalizedStyle(rawType.style, `lineTypes[${index}].style`),
      width: normalizedWidth(rawType.width, `lineTypes[${index}].width`),
    };
  });

  return { lineTypes };
}
