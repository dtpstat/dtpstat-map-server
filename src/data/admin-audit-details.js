import crypto from 'node:crypto';

const REDACTED = '[redacted]';
const MAX_STRING_LENGTH = 1000;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_DEPTH = 8;
const MAX_CHANGES = 200;
const DEFAULT_IGNORED_KEYS = new Set(['createdAt', 'updatedAt']);
const SENSITIVE_KEY = /(?:password|passphrase|secret|token|authorization|cookie|session|hash|credential|private.?key|api.?key)/i;

function isBinary(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array;
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function sensitivePath(path) {
  return path.some((part) => typeof part === 'string' && SENSITIVE_KEY.test(part));
}

function truncatedString(value) {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}… [truncated ${value.length - MAX_STRING_LENGTH} chars]`;
}

function sanitize(value, path = [], depth = 0) {
  if (sensitivePath(path)) return REDACTED;
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value ?? null;
  }
  if (typeof value === 'string') return truncatedString(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value.toISOString() : String(value);
  if (isBinary(value)) return { binary: true, bytes: value.byteLength };
  if (depth >= MAX_DEPTH) return '[max-depth]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item, index) =>
      sanitize(item, [...path, index], depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push({ truncatedItems: value.length - MAX_ARRAY_ITEMS });
    }
    return items;
  }
  if (isObject(value)) {
    const result = {};
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    for (const [key, item] of entries) result[key] = sanitize(item, [...path, key], depth + 1);
    const extra = Object.keys(value).length - entries.length;
    if (extra > 0) result.__truncatedKeys = extra;
    return result;
  }
  return truncatedString(String(value));
}

function equivalent(left, right) {
  if (Object.is(left, right)) return true;
  if (isBinary(left) && isBinary(right)) {
    return Buffer.from(left).equals(Buffer.from(right));
  }
  if (left instanceof Date && right instanceof Date) return left.valueOf() === right.valueOf();
  if (!isObject(left) || !isObject(right)) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function pathText(path) {
  if (path.length === 0) return '$';
  return path.reduce((result, part) => (
    typeof part === 'number'
      ? `${result}[${part}]`
      : result ? `${result}.${part}` : part
  ), '');
}

function addChange(state, path, before, after, sensitive = false) {
  if (state.changes.length >= state.maxChanges) {
    state.truncated = true;
    return;
  }
  state.changes.push({
    path: pathText(path),
    before: sensitive ? REDACTED : sanitize(before, path),
    after: sensitive ? REDACTED : sanitize(after, path),
    ...(sensitive ? { sensitive: true } : {}),
  });
}

function walkChanges(before, after, path, state, depth) {
  if (state.truncated || equivalent(before, after)) return;
  const key = path.at(-1);
  if (typeof key === 'string' && state.ignoredKeys.has(key)) return;
  if (sensitivePath(path)) {
    addChange(state, path, before, after, true);
    return;
  }
  if (depth >= state.maxDepth) {
    addChange(state, path, before, after);
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      if (state.truncated) break;
      if (index >= before.length || index >= after.length) {
        addChange(state, [...path, index], before[index], after[index]);
      } else {
        walkChanges(before[index], after[index], [...path, index], state, depth + 1);
      }
    }
    return;
  }

  const beforePlain = isObject(before) && !Array.isArray(before) && !isBinary(before) && !(before instanceof Date);
  const afterPlain = isObject(after) && !Array.isArray(after) && !isBinary(after) && !(after instanceof Date);
  if (beforePlain && afterPlain) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const childKey of keys) {
      if (state.truncated) break;
      if (state.ignoredKeys.has(childKey)) continue;
      if (!(childKey in before) || !(childKey in after)) {
        addChange(state, [...path, childKey], before[childKey], after[childKey], SENSITIVE_KEY.test(childKey));
      } else {
        walkChanges(before[childKey], after[childKey], [...path, childKey], state, depth + 1);
      }
    }
    return;
  }

  addChange(state, path, before, after);
}

/**
 * Build a bounded, field-level before/after change set for administrator audit.
 * Security-like field names are never persisted in clear text.
 */
export function createAdminAuditChangeSet(before, after, options = {}) {
  const state = {
    changes: [],
    truncated: false,
    maxChanges: options.maxChanges ?? MAX_CHANGES,
    maxDepth: options.maxDepth ?? MAX_DEPTH,
    ignoredKeys: new Set(options.ignoredKeys ?? DEFAULT_IGNORED_KEYS),
  };
  walkChanges(before, after, [], state, 0);
  return {
    changes: state.changes,
    ...(state.truncated ? { changesTruncated: true } : {}),
  };
}

/** Sanitize arbitrary operation/task metadata before it reaches logs or audit JSON. */
export function sanitizeAdminAuditData(value) {
  return sanitize(value);
}

/**
 * Produce a content fingerprint for large imported payloads without storing the
 * payload itself. Useful for incident reconstruction and duplicate detection.
 */
export function adminAuditPayloadFingerprint(payload) {
  let bytes;
  if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) {
    bytes = Buffer.from(payload);
  } else if (typeof payload === 'string') {
    bytes = Buffer.from(payload, 'utf8');
  } else {
    bytes = Buffer.from(JSON.stringify(payload ?? null), 'utf8');
  }
  return {
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}
