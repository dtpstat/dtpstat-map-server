export class ProjectSettingsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProjectSettingsValidationError';
  }
}

export const PROJECT_CONTENT_TAGS = Object.freeze([
  'p',
  'h2',
  'h3',
  'h4',
  'a',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'br',
  'hr',
  'span',
  'div',
  'small',
]);

export const PROJECT_CONTENT_CLASSES = Object.freeze([
  'project-lead',
  'project-muted',
  'project-callout',
  'project-compact',
  'project-columns',
  'project-link-button',
]);

const VOID_TAGS = new Set(['br', 'hr']);
const ALLOWED_TAGS = new Set(PROJECT_CONTENT_TAGS);
const ALLOWED_CLASSES = new Set(PROJECT_CONTENT_CLASSES);
const GLOBAL_ATTRIBUTES = new Set(['class', 'id']);
const LINK_ATTRIBUTES = new Set(['href', 'title', 'target', 'rel']);
const REL_VALUES = new Set(['noopener', 'noreferrer', 'nofollow']);

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function decodeAttribute(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function normalizeProjectName(value) {
  if (typeof value !== 'string') {
    throw new ProjectSettingsValidationError('projectName must be a string');
  }
  const normalized = value.trim().replace(/\s+/g, ' ').normalize('NFC');
  if (!normalized || normalized.length > 160) {
    throw new ProjectSettingsValidationError(
      'projectName must contain between 1 and 160 characters',
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ProjectSettingsValidationError('projectName contains control characters');
  }
  return normalized;
}

function normalizeKeyword(value, index) {
  if (typeof value !== 'string') {
    throw new ProjectSettingsValidationError(`keywords[${index}] must be a string`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ').normalize('NFC');
  if (!normalized || normalized.length > 80) {
    throw new ProjectSettingsValidationError(
      `keywords[${index}] must contain between 1 and 80 characters`,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ProjectSettingsValidationError(`keywords[${index}] contains control characters`);
  }
  return normalized;
}

function normalizeKeywords(value) {
  if (!Array.isArray(value)) {
    throw new ProjectSettingsValidationError('keywords must be an array of strings');
  }
  if (value.length > 50) {
    throw new ProjectSettingsValidationError('keywords may contain at most 50 entries');
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const keyword = normalizeKeyword(value[index], index);
    const key = keyword.toLocaleLowerCase('ru-RU');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

function normalizeOptionalIdentifier(value, fieldName, pattern, format) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ProjectSettingsValidationError(`${fieldName} must be a string or null`);
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (!pattern.test(normalized)) {
    throw new ProjectSettingsValidationError(`${fieldName} must match ${format}`);
  }
  return normalized;
}

function normalizeYandexMetrikaId(value) {
  return normalizeOptionalIdentifier(
    value,
    'yandexMetrikaId',
    /^[1-9][0-9]{0,14}$/,
    'a positive numeric counter ID up to 15 digits',
  );
}

function normalizeGoogleAnalyticsId(value) {
  return normalizeOptionalIdentifier(
    value,
    'googleAnalyticsId',
    /^G-[A-Z0-9]{4,32}$/,
    'G- followed by 4-32 letters or digits',
  );
}

function safeHref(value) {
  const href = value.trim();
  if (!href) return false;
  if (href.startsWith('#')) return true;
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  if (href.startsWith('./') || href.startsWith('../')) return true;
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:', 'tel:', 'tg:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function parseAttributes(raw, tagName) {
  const attributes = [];
  let remaining = raw.trim();
  while (remaining) {
    if (remaining === '/') break;
    const match = remaining.match(
      /^([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/,
    );
    if (!match) {
      throw new ProjectSettingsValidationError(
        `footerHtml contains malformed attributes on <${tagName}>`,
      );
    }
    const name = match[1].toLocaleLowerCase('en-US');
    const value = decodeAttribute(match[2] ?? match[3] ?? match[4] ?? '');
    const allowed = GLOBAL_ATTRIBUTES.has(name) ||
      (tagName === 'a' && LINK_ATTRIBUTES.has(name));
    if (!allowed) {
      throw new ProjectSettingsValidationError(
        `footerHtml attribute ${name} is not allowed on <${tagName}>`,
      );
    }
    if (name === 'class') {
      const classes = value.split(/\s+/).filter(Boolean);
      if (classes.some((className) => !ALLOWED_CLASSES.has(className))) {
        throw new ProjectSettingsValidationError(
          `footerHtml contains an unsupported CSS class on <${tagName}>`,
        );
      }
      if (classes.length > 0) attributes.push(['class', classes.join(' ')]);
    } else if (name === 'id') {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) {
        throw new ProjectSettingsValidationError('footerHtml contains an invalid id');
      }
      attributes.push(['id', value]);
    } else if (name === 'href') {
      if (!safeHref(value)) {
        throw new ProjectSettingsValidationError('footerHtml contains an unsafe link URL');
      }
      attributes.push(['href', value.trim()]);
    } else if (name === 'target') {
      if (!['_blank', '_self'].includes(value)) {
        throw new ProjectSettingsValidationError(
          'footerHtml link target must be _blank or _self',
        );
      }
      attributes.push(['target', value]);
    } else if (name === 'rel') {
      const rel = value.split(/\s+/).filter(Boolean);
      if (rel.some((item) => !REL_VALUES.has(item))) {
        throw new ProjectSettingsValidationError('footerHtml contains an unsupported rel value');
      }
      if (rel.length > 0) attributes.push(['rel', [...new Set(rel)].join(' ')]);
    } else if (name === 'title') {
      if (value.length > 300) {
        throw new ProjectSettingsValidationError('footerHtml link title is too long');
      }
      attributes.push(['title', value]);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }

  if (tagName === 'a') {
    const target = attributes.find(([name]) => name === 'target')?.[1];
    if (target === '_blank') {
      const relIndex = attributes.findIndex(([name]) => name === 'rel');
      const current = relIndex >= 0
        ? attributes[relIndex][1].split(/\s+/).filter(Boolean)
        : [];
      const rel = [...new Set([...current, 'noopener', 'noreferrer'])].join(' ');
      if (relIndex >= 0) attributes[relIndex] = ['rel', rel];
      else attributes.push(['rel', rel]);
    }
  }

  return attributes;
}

export function normalizeProjectFooterHtml(value) {
  if (typeof value !== 'string') {
    throw new ProjectSettingsValidationError('footerHtml must be a string');
  }
  const html = value.trim();
  if (!html) {
    throw new ProjectSettingsValidationError('footerHtml must not be empty');
  }
  if (html.length > 65536) {
    throw new ProjectSettingsValidationError('footerHtml exceeds 65536 characters');
  }

  const output = [];
  const stack = [];
  const tagPattern = /<[^>]*>/g;
  let cursor = 0;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    const text = html.slice(cursor, match.index);
    if (text.includes('<')) {
      throw new ProjectSettingsValidationError('footerHtml contains malformed markup');
    }
    output.push(text);
    const token = match[0];
    if (/^<\s*[!/]/.test(token) && !/^<\s*\//.test(token)) {
      throw new ProjectSettingsValidationError('footerHtml comments and declarations are not allowed');
    }

    const closing = token.match(/^<\s*\/\s*([A-Za-z0-9]+)\s*>$/);
    if (closing) {
      const tagName = closing[1].toLocaleLowerCase('en-US');
      if (!ALLOWED_TAGS.has(tagName) || VOID_TAGS.has(tagName)) {
        throw new ProjectSettingsValidationError(
          `footerHtml closing tag </${tagName}> is not allowed`,
        );
      }
      if (stack.pop() !== tagName) {
        throw new ProjectSettingsValidationError(
          `footerHtml has unbalanced </${tagName}>`,
        );
      }
      output.push(`</${tagName}>`);
      cursor = tagPattern.lastIndex;
      continue;
    }

    const opening = token.match(/^<\s*([A-Za-z0-9]+)([\s\S]*?)\/?>$/);
    if (!opening) {
      throw new ProjectSettingsValidationError('footerHtml contains malformed markup');
    }
    const tagName = opening[1].toLocaleLowerCase('en-US');
    if (!ALLOWED_TAGS.has(tagName)) {
      throw new ProjectSettingsValidationError(
        `footerHtml tag <${tagName}> is not allowed`,
      );
    }
    const attributes = parseAttributes(opening[2], tagName);
    const serialized = attributes
      .map(([name, attributeValue]) => ` ${name}="${escapeAttribute(attributeValue)}"`)
      .join('');
    output.push(`<${tagName}${serialized}>`);
    if (!VOID_TAGS.has(tagName)) stack.push(tagName);
    cursor = tagPattern.lastIndex;
  }

  const tail = html.slice(cursor);
  if (tail.includes('<')) {
    throw new ProjectSettingsValidationError('footerHtml contains malformed markup');
  }
  output.push(tail);
  if (stack.length > 0) {
    throw new ProjectSettingsValidationError(
      `footerHtml has an unclosed <${stack.at(-1)}> tag`,
    );
  }
  return output.join('').trim();
}

export function buildProjectSettingsPlan(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProjectSettingsValidationError('Request body must be a JSON object');
  }
  const allowed = new Set([
    'projectName',
    'keywords',
    'footerHtml',
    'yandexMetrikaId',
    'googleAnalyticsId',
  ]);
  const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ProjectSettingsValidationError(
      `Request body contains unsupported properties: ${unknown.join(', ')}`,
    );
  }
  return {
    projectName: normalizeProjectName(payload.projectName),
    keywords: normalizeKeywords(payload.keywords),
    footerHtml: normalizeProjectFooterHtml(payload.footerHtml),
    yandexMetrikaId: normalizeYandexMetrikaId(payload.yandexMetrikaId),
    googleAnalyticsId: normalizeGoogleAnalyticsId(payload.googleAnalyticsId),
  };
}
