import crypto from 'node:crypto';
import { promisify } from 'node:util';
import {
  adminPasswordPolicy,
  AdminSecurityValidationError,
  DEFAULT_ADMIN_PASSWORD_POLICY,
  normalizeAdminPassword,
} from './policy.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const PASSWORD_FORMAT = 'scrypt-v1';
const SESSION_TOKEN_BYTES = 32;
const TEMP_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TEMP_PASSWORD_SPECIAL = '!@#$%&*+-_=';

async function derivePassword(
  password,
  salt,
  parameters = {},
) {
  return scrypt(password, salt, SCRYPT_BYTES, {
    N: parameters.N ?? SCRYPT_N,
    r: parameters.r ?? SCRYPT_R,
    p: parameters.p ?? SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

export async function hashAdminPassword(
  value,
  options = {},
) {
  const password = normalizeAdminPassword(
    value,
    options,
  );
  const salt = crypto.randomBytes(16);
  const derived = await derivePassword(
    password,
    salt,
  );

  return [
    PASSWORD_FORMAT,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    Buffer.from(derived).toString('base64url'),
  ].join('$');
}

export async function verifyAdminPassword(
  value,
  encodedHash,
) {
  if (
    typeof value !== 'string' ||
    typeof encodedHash !== 'string'
  ) {
    return false;
  }

  const [
    format,
    rawN,
    rawR,
    rawP,
    rawSalt,
    rawHash,
    extra,
  ] = encodedHash.split('$');

  if (
    format !== PASSWORD_FORMAT ||
    extra !== undefined
  ) {
    return false;
  }

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  const salt = Buffer.from(
    rawSalt ?? '',
    'base64url',
  );
  const expected = Buffer.from(
    rawHash ?? '',
    'base64url',
  );

  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    salt.length < 8 ||
    expected.length !== SCRYPT_BYTES
  ) {
    return false;
  }

  const actual = Buffer.from(
    await derivePassword(value, salt, {
      N,
      r,
      p,
    }),
  );

  return crypto.timingSafeEqual(
    actual,
    expected,
  );
}

export async function burnUnknownPasswordCheck(
  password,
) {
  const salt = Buffer.from(
    'dtpstat-admin-auth',
    'utf8',
  );
  const actual = Buffer.from(
    await derivePassword(
      String(password ?? ''),
      salt,
    ),
  );

  crypto.timingSafeEqual(
    actual,
    Buffer.alloc(actual.length),
  );
}

export function parseBasicAuthorization(
  authorization,
) {
  if (!authorization) {
    return {
      status: 'missing',
      username: null,
      password: null,
    };
  }

  const [scheme, encoded, extra] =
    authorization.trim().split(/\s+/);

  if (
    scheme?.toLocaleLowerCase('en-US') !== 'basic' ||
    !encoded ||
    extra
  ) {
    return {
      status: 'invalid',
      username: null,
      password: null,
    };
  }

  let decoded;
  try {
    decoded = Buffer.from(
      encoded,
      'base64',
    ).toString('utf8');
  } catch {
    return {
      status: 'invalid',
      username: null,
      password: null,
    };
  }

  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return {
      status: 'invalid',
      username: null,
      password: null,
    };
  }

  return {
    status: 'credentials',
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

export function adminSessionTokenHash(token) {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest();
}

export function generateAdminSessionToken() {
  return crypto
    .randomBytes(SESSION_TOKEN_BYTES)
    .toString('base64url');
}

export function generateTemporaryPassword(
  policy = DEFAULT_ADMIN_PASSWORD_POLICY,
) {
  const rules = adminPasswordPolicy(policy);
  const required = [];

  if (rules.passwordRequireLowercase) {
    required.push(
      'abcdefghijkmnopqrstuvwxyz',
    );
  }
  if (rules.passwordRequireUppercase) {
    required.push(
      'ABCDEFGHJKLMNPQRSTUVWXYZ',
    );
  }
  if (rules.passwordRequireDigit) {
    required.push('23456789');
  }
  if (rules.passwordRequireSpecial) {
    required.push(TEMP_PASSWORD_SPECIAL);
  }

  const targetLength = Math.min(
    rules.passwordMaxLength,
    Math.max(
      rules.passwordMinLength,
      Math.min(16, rules.passwordMaxLength),
    ),
  );

  if (targetLength < required.length) {
    throw new AdminSecurityValidationError(
      'Password policy cannot generate a compliant temporary password',
    );
  }

  const randomChar = (alphabet) =>
    alphabet[
      crypto.randomInt(0, alphabet.length)
    ];

  const characters = required.map(randomChar);
  const alphabet =
    TEMP_PASSWORD_ALPHABET +
    (
      rules.passwordRequireSpecial
        ? TEMP_PASSWORD_SPECIAL
        : ''
    );

  while (characters.length < targetLength) {
    characters.push(randomChar(alphabet));
  }

  for (
    let index = characters.length - 1;
    index > 0;
    index -= 1
  ) {
    const swap = crypto.randomInt(
      0,
      index + 1,
    );
    [
      characters[index],
      characters[swap],
    ] = [
      characters[swap],
      characters[index],
    ];
  }

  return characters.join('');
}
