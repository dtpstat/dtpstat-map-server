import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const PASSWORD_FORMAT = 'scrypt-v1';

export class AdminSecurityValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminSecurityValidationError';
  }
}

export function normalizeAdminUsername(value) {
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError('username must be a string');
  }
  const username = value.trim().replace(/\s+/g, ' ').normalize('NFC');
  if (!username || username.length > 64) {
    throw new AdminSecurityValidationError('username must contain between 1 and 64 characters');
  }
  if (username.includes(':') || /[\u0000-\u001f\u007f]/.test(username)) {
    throw new AdminSecurityValidationError('username contains unsupported characters');
  }
  return username;
}

export function normalizeAdminEmail(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError('email must be a string or null');
  }
  const email = value.trim().toLocaleLowerCase('en-US');
  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new AdminSecurityValidationError('email must contain a valid address up to 320 characters');
  }
  return email;
}

function normalizePassword(value, { bootstrap = false } = {}) {
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError('password must be a string');
  }
  const minimum = bootstrap ? 1 : 12;
  if (value.length < minimum || value.length > 1024) {
    throw new AdminSecurityValidationError(
      bootstrap
        ? 'bootstrap password must not be empty'
        : 'password must contain between 12 and 1024 characters',
    );
  }
  return value;
}

function booleanField(value, name, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new AdminSecurityValidationError(`${name} must be boolean`);
  }
  return value;
}

function integerField(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AdminSecurityValidationError(
      `${name} must be an integer between ${min} and ${max}`,
    );
  }
  return value;
}

export function normalizeAdminSecuritySettings(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AdminSecurityValidationError('Request body must be a JSON object');
  }
  const allowed = new Set([
    'maxFailedAttempts',
    'failureWindowSeconds',
    'lockoutSeconds',
  ]);
  const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new AdminSecurityValidationError(
      `Request body contains unsupported properties: ${unknown.join(', ')}`,
    );
  }
  return {
    maxFailedAttempts: integerField(payload.maxFailedAttempts, 'maxFailedAttempts', 1, 100),
    failureWindowSeconds: integerField(
      payload.failureWindowSeconds,
      'failureWindowSeconds',
      10,
      86400,
    ),
    lockoutSeconds: integerField(payload.lockoutSeconds, 'lockoutSeconds', 10, 604800),
  };
}

async function derivePassword(password, salt, parameters = {}) {
  return scrypt(password, salt, SCRYPT_BYTES, {
    N: parameters.N ?? SCRYPT_N,
    r: parameters.r ?? SCRYPT_R,
    p: parameters.p ?? SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

export async function hashAdminPassword(value, options = {}) {
  const password = normalizePassword(value, options);
  const salt = crypto.randomBytes(16);
  const derived = await derivePassword(password, salt);
  return [
    PASSWORD_FORMAT,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    Buffer.from(derived).toString('base64url'),
  ].join('$');
}

export async function verifyAdminPassword(value, encodedHash) {
  if (typeof value !== 'string' || typeof encodedHash !== 'string') return false;
  const [format, rawN, rawR, rawP, rawSalt, rawHash, extra] = encodedHash.split('$');
  if (format !== PASSWORD_FORMAT || extra !== undefined) return false;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  const salt = Buffer.from(rawSalt ?? '', 'base64url');
  const expected = Buffer.from(rawHash ?? '', 'base64url');
  if (
    !Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) ||
    salt.length < 8 || expected.length !== SCRYPT_BYTES
  ) return false;
  const actual = Buffer.from(await derivePassword(value, salt, { N, r, p }));
  return crypto.timingSafeEqual(actual, expected);
}

async function burnUnknownPasswordCheck(password) {
  const salt = Buffer.from('dtpstat-admin-auth', 'utf8');
  const actual = Buffer.from(await derivePassword(String(password ?? ''), salt));
  const expected = Buffer.alloc(actual.length);
  crypto.timingSafeEqual(actual, expected);
}

function parseBasicAuthorization(authorization) {
  if (!authorization) return { status: 'missing', username: null, password: null };
  const [scheme, encoded, extra] = authorization.trim().split(/\s+/);
  if (scheme?.toLocaleLowerCase('en-US') !== 'basic' || !encoded || extra) {
    return { status: 'invalid', username: null, password: null };
  }
  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return { status: 'invalid', username: null, password: null };
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return { status: 'invalid', username: null, password: null };
  }
  return {
    status: 'credentials',
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    canManageData: Boolean(user.canManageData),
    canManageInterface: Boolean(user.canManageInterface),
    isSuperuser: Boolean(user.isSuperuser),
    isBootstrap: Boolean(user.isBootstrap),
    isBlocked: Boolean(user.isBlocked),
    lockedUntil: user.lockedUntil ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
    passwordChangedAt: user.passwordChangedAt ?? null,
    createdAt: user.createdAt ?? null,
    updatedAt: user.updatedAt ?? null,
  };
}

function normalizedIp(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, 128) : null;
}

function duplicateUsername(error) {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === '23505',
  );
}

/**
 * @param {{
 *   countUsers: Function,
 *   findUserByUsername: Function,
 *   getUser: Function,
 *   listUsers: Function,
 *   createUser: Function,
 *   updateUser: Function,
 *   updatePassword: Function,
 *   recordSuccessfulLogin: Function,
 *   recordFailedLogin: Function,
 *   getSecuritySettings: Function,
 *   saveSecuritySettings: Function,
 *   appendAudit: Function,
 *   listAudit: Function
 * }} repository
 */
export function createAdminSecurityService(repository) {
  async function appendAudit(entry) {
    return repository.appendAudit({
      ...entry,
      ipAddress: normalizedIp(entry.ipAddress),
    });
  }

  async function bootstrap({ username, password }) {
    const count = await repository.countUsers();
    if (count > 0) return { created: false };
    if (!username || !password) {
      throw new Error(
        'No administrator exists. Set IMPORT_API_USERNAME and IMPORT_API_PASSWORD for the first startup after the admin-security migrations.',
      );
    }
    const normalizedUsername = normalizeAdminUsername(username);
    const passwordHash = await hashAdminPassword(password, { bootstrap: true });
    try {
      const user = await repository.createUser({
        username: normalizedUsername,
        email: null,
        passwordHash,
        canManageData: true,
        canManageInterface: true,
        isSuperuser: true,
        isBootstrap: true,
      });
      await appendAudit({
        eventType: 'security',
        operationType: 'admin.bootstrap',
        status: 'succeeded',
        durationMs: null,
        userId: user.id,
        username: user.username,
        details: { source: 'environment' },
      });
      return { created: true, user: publicUser(user) };
    } catch (error) {
      if (duplicateUsername(error) && await repository.countUsers() > 0) {
        return { created: false };
      }
      throw error;
    }
  }

  async function authenticate(authorization, context = {}) {
    const startedAt = Date.now();
    const credentials = parseBasicAuthorization(authorization);
    if (credentials.status === 'missing') return { status: 'missing', user: null };
    if (credentials.status !== 'credentials') {
      await appendAudit({
        eventType: 'authentication',
        operationType: 'admin.login',
        status: 'failed',
        durationMs: Date.now() - startedAt,
        ipAddress: context.ipAddress,
        details: { reason: 'malformed-authorization' },
      });
      return { status: 'invalid', user: null };
    }

    let normalizedUsername;
    try {
      normalizedUsername = normalizeAdminUsername(credentials.username);
    } catch {
      normalizedUsername = credentials.username.slice(0, 64);
    }
    const user = await repository.findUserByUsername(normalizedUsername);
    if (!user) {
      await burnUnknownPasswordCheck(credentials.password);
      await appendAudit({
        eventType: 'authentication',
        operationType: 'admin.login',
        status: 'failed',
        durationMs: Date.now() - startedAt,
        ipAddress: context.ipAddress,
        username: normalizedUsername || null,
        details: { reason: 'invalid-credentials' },
      });
      return { status: 'invalid', user: null };
    }

    if (user.isBlocked) {
      await appendAudit({
        eventType: 'authentication',
        operationType: 'admin.login',
        status: 'blocked',
        durationMs: Date.now() - startedAt,
        ipAddress: context.ipAddress,
        userId: user.id,
        username: user.username,
        details: { reason: 'manual-block' },
      });
      return { status: 'blocked', user: publicUser(user) };
    }

    const now = new Date();
    const lockedUntil = user.lockedUntil ? new Date(user.lockedUntil) : null;
    if (lockedUntil && lockedUntil > now) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((lockedUntil.valueOf() - now.valueOf()) / 1000),
      );
      await appendAudit({
        eventType: 'authentication',
        operationType: 'admin.login',
        status: 'locked',
        durationMs: Date.now() - startedAt,
        ipAddress: context.ipAddress,
        userId: user.id,
        username: user.username,
        details: { retryAfterSeconds },
      });
      return { status: 'locked', user: publicUser(user), retryAfterSeconds };
    }

    const validPassword = await verifyAdminPassword(credentials.password, user.passwordHash);
    if (!validPassword) {
      const settings = await repository.getSecuritySettings();
      const updated = await repository.recordFailedLogin(
        user.id,
        now.toISOString(),
        settings,
      );
      const nextLockedUntil = updated?.lockedUntil ? new Date(updated.lockedUntil) : null;
      const isLocked = nextLockedUntil && nextLockedUntil > now;
      const retryAfterSeconds = isLocked
        ? Math.max(1, Math.ceil((nextLockedUntil.valueOf() - now.valueOf()) / 1000))
        : null;
      await appendAudit({
        eventType: 'authentication',
        operationType: 'admin.login',
        status: isLocked ? 'locked' : 'failed',
        durationMs: Date.now() - startedAt,
        ipAddress: context.ipAddress,
        userId: user.id,
        username: user.username,
        details: {
          reason: 'invalid-credentials',
          failedLoginCount: updated?.failedLoginCount ?? null,
          ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
        },
      });
      return {
        status: isLocked ? 'locked' : 'invalid',
        user: null,
        retryAfterSeconds,
      };
    }

    let authenticatedUser = user;
    if (
      context.recordLogin ||
      user.failedLoginCount > 0 ||
      user.failedLoginWindowStartedAt ||
      user.lockedUntil
    ) {
      authenticatedUser = await repository.recordSuccessfulLogin(
        user.id,
        now.toISOString(),
      ) ?? user;
    }
    if (context.recordLogin) {
      await appendAudit({
        eventType: 'authentication',
        operationType: 'admin.login',
        status: 'succeeded',
        durationMs: Date.now() - startedAt,
        ipAddress: context.ipAddress,
        userId: user.id,
        username: user.username,
        details: {},
      });
    }
    return { status: 'success', user: publicUser(authenticatedUser) };
  }

  async function createUser(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const allowed = new Set([
      'username', 'email', 'password', 'canManageData', 'canManageInterface',
    ]);
    const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      throw new AdminSecurityValidationError(
        `Request body contains unsupported properties: ${unknown.join(', ')}`,
      );
    }
    const user = {
      username: normalizeAdminUsername(payload.username),
      email: normalizeAdminEmail(payload.email),
      passwordHash: await hashAdminPassword(payload.password),
      canManageData: booleanField(payload.canManageData, 'canManageData'),
      canManageInterface: booleanField(payload.canManageInterface, 'canManageInterface'),
      isSuperuser: false,
      isBootstrap: false,
    };
    try {
      return publicUser(await repository.createUser(user));
    } catch (error) {
      if (duplicateUsername(error)) {
        throw new AdminSecurityValidationError('A user with this username already exists');
      }
      throw error;
    }
  }

  async function updateUser(userId, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const allowed = new Set(['email', 'canManageData', 'canManageInterface', 'isBlocked']);
    const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      throw new AdminSecurityValidationError(
        `Request body contains unsupported properties: ${unknown.join(', ')}`,
      );
    }
    const current = await repository.getUser(userId);
    if (!current) return null;

    if (current.isBootstrap) {
      if (payload.isBlocked === true) {
        throw new AdminSecurityValidationError(
          'Bootstrap administrator cannot be manually blocked',
        );
      }
      if (payload.canManageData === false || payload.canManageInterface === false) {
        throw new AdminSecurityValidationError(
          'Bootstrap administrator must retain both administrative permissions',
        );
      }
    }

    const protectedUser = current.isBootstrap || current.isSuperuser;
    const next = {
      email: normalizeAdminEmail(payload.email),
      canManageData: protectedUser
        ? true
        : booleanField(payload.canManageData, 'canManageData', current.canManageData),
      canManageInterface: protectedUser
        ? true
        : booleanField(
          payload.canManageInterface,
          'canManageInterface',
          current.canManageInterface,
        ),
      isBlocked: protectedUser
        ? false
        : booleanField(payload.isBlocked, 'isBlocked', current.isBlocked),
    };
    return publicUser(await repository.updateUser(userId, next));
  }

  async function changePassword(userId, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const unknown = Object.keys(payload).filter((key) => key !== 'password');
    if (unknown.length > 0) {
      throw new AdminSecurityValidationError(
        `Request body contains unsupported properties: ${unknown.join(', ')}`,
      );
    }
    const current = await repository.getUser(userId);
    if (!current) return null;
    const passwordHash = await hashAdminPassword(payload.password);
    return publicUser(await repository.updatePassword(userId, passwordHash));
  }

  async function saveSecuritySettings(payload) {
    return repository.saveSecuritySettings(normalizeAdminSecuritySettings(payload));
  }

  return {
    bootstrap,
    authenticate,
    appendAudit,
    listUsers: () => repository.listUsers().then((users) => users.map(publicUser)),
    createUser,
    updateUser,
    changePassword,
    getSecuritySettings: () => repository.getSecuritySettings(),
    saveSecuritySettings,
    listAudit: (options) => repository.listAudit(options),
  };
}
