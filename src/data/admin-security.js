import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { securityLog } from '../service-log.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const PASSWORD_FORMAT = 'scrypt-v1';
const SESSION_TOKEN_BYTES = 32;
const AVATAR_MAX_BYTES = 256 * 1024;
const AVATAR_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

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

export function normalizeAdminDisplayName(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError('displayName must be a string or null');
  }
  const displayName = value.trim().replace(/\s+/g, ' ').normalize('NFC');
  if (!displayName || displayName.length > 160) {
    throw new AdminSecurityValidationError('displayName must contain between 1 and 160 characters');
  }
  return displayName;
}

export function normalizeAdminEmail(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError('email must be a string or null');
  }
  const email = value.trim().toLocaleLowerCase('en-US');
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
    throw new AdminSecurityValidationError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function normalizeAdminSecuritySettings(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AdminSecurityValidationError('Request body must be a JSON object');
  }
  const allowed = new Set([
    'maxFailedAttempts', 'failureWindowSeconds', 'lockoutSeconds',
    'ipMaxFailedAttempts', 'ipFailureWindowSeconds', 'ipLockoutSeconds',
    'sessionIdleSeconds', 'sessionAbsoluteSeconds', 'auditRetentionDays',
  ]);
  const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new AdminSecurityValidationError(
      `Request body contains unsupported properties: ${unknown.join(', ')}`,
    );
  }
  return {
    maxFailedAttempts: integerField(payload.maxFailedAttempts, 'maxFailedAttempts', 1, 100),
    failureWindowSeconds: integerField(payload.failureWindowSeconds, 'failureWindowSeconds', 10, 86400),
    lockoutSeconds: integerField(payload.lockoutSeconds, 'lockoutSeconds', 10, 604800),
    ipMaxFailedAttempts: integerField(payload.ipMaxFailedAttempts, 'ipMaxFailedAttempts', 1, 1000),
    ipFailureWindowSeconds: integerField(payload.ipFailureWindowSeconds, 'ipFailureWindowSeconds', 10, 86400),
    ipLockoutSeconds: integerField(payload.ipLockoutSeconds, 'ipLockoutSeconds', 10, 604800),
    sessionIdleSeconds: integerField(payload.sessionIdleSeconds, 'sessionIdleSeconds', 60, 86400),
    sessionAbsoluteSeconds: integerField(payload.sessionAbsoluteSeconds, 'sessionAbsoluteSeconds', 300, 2592000),
    auditRetentionDays: integerField(payload.auditRetentionDays, 'auditRetentionDays', 0, 3650),
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
    PASSWORD_FORMAT, SCRYPT_N, SCRYPT_R, SCRYPT_P,
    salt.toString('base64url'), Buffer.from(derived).toString('base64url'),
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
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) ||
      salt.length < 8 || expected.length !== SCRYPT_BYTES) return false;
  const actual = Buffer.from(await derivePassword(value, salt, { N, r, p }));
  return crypto.timingSafeEqual(actual, expected);
}

async function burnUnknownPasswordCheck(password) {
  const salt = Buffer.from('dtpstat-admin-auth', 'utf8');
  const actual = Buffer.from(await derivePassword(String(password ?? ''), salt));
  crypto.timingSafeEqual(actual, Buffer.alloc(actual.length));
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
  if (separator < 0) return { status: 'invalid', username: null, password: null };
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
    displayName: user.displayName ?? user.username,
    email: user.email ?? null,
    canManageData: Boolean(user.canManageData),
    canManageInterface: Boolean(user.canManageInterface),
    canManageUsers: Boolean(user.canManageUsers),
    canViewAudit: Boolean(user.canViewAudit),
    canManageSecurity: Boolean(user.canManageSecurity),
    isSuperuser: Boolean(user.isSuperuser),
    isBootstrap: Boolean(user.isBootstrap),
    isBlocked: Boolean(user.isBlocked),
    manualBlockedAt: user.manualBlockedAt ?? null,
    manualBlockedUntil: user.manualBlockedUntil ?? null,
    manualBlockReason: user.manualBlockReason ?? null,
    mustChangePassword: Boolean(user.mustChangePassword),
    hasAvatar: Boolean(user.hasAvatar),
    avatarMime: user.avatarMime ?? null,
    lockedUntil: user.lockedUntil ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
    passwordChangedAt: user.passwordChangedAt ?? null,
    createdAt: user.createdAt ?? null,
    updatedAt: user.updatedAt ?? null,
  };
}

export function normalizeAdminIp(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return (text.startsWith('::ffff:') ? text.slice(7) : text).slice(0, 128);
}

function duplicateUsername(error) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest();
}

export function generateTemporaryPassword() {
  const bytes = crypto.randomBytes(16);
  let raw = '';
  for (const byte of bytes) raw += TEMP_PASSWORD_ALPHABET[byte % TEMP_PASSWORD_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function secondsUntil(timestamp, now = new Date()) {
  if (!timestamp) return null;
  const target = new Date(timestamp);
  if (!Number.isFinite(target.valueOf()) || target <= now) return null;
  return Math.max(1, Math.ceil((target.valueOf() - now.valueOf()) / 1000));
}

function normalizeReason(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new AdminSecurityValidationError('reason must be a string or null');
  const reason = value.trim();
  if (reason.length > 500) throw new AdminSecurityValidationError('reason must be at most 500 characters');
  return reason || null;
}

function normalizeDurationSeconds(value) {
  if (value === undefined || value === null || value === 0) return null;
  return integerField(value, 'durationSeconds', 60, 31536000);
}

export function createAdminSecurityService(repository) {
  async function appendAudit(entry) {
    return repository.appendAudit({ ...entry, ipAddress: normalizeAdminIp(entry.ipAddress) });
  }

  async function bootstrap({ username, password }) {
    if (await repository.countUsers() > 0) return { created: false };
    if (!username || !password) {
      throw new Error('No administrator exists. Set IMPORT_API_USERNAME and IMPORT_API_PASSWORD for the first startup after the admin-security migrations.');
    }
    const normalizedUsername = normalizeAdminUsername(username);
    const passwordHash = await hashAdminPassword(password, { bootstrap: true });
    try {
      const user = await repository.createUser({
        username: normalizedUsername,
        displayName: normalizedUsername,
        email: null,
        passwordHash,
        canManageData: true,
        canManageInterface: true,
        canManageUsers: true,
        canViewAudit: true,
        canManageSecurity: true,
        isSuperuser: true,
        isBootstrap: true,
        mustChangePassword: false,
      });
      await appendAudit({
        eventType: 'security', operationType: 'admin.bootstrap', status: 'succeeded',
        durationMs: null, userId: user.id, username: user.username,
        details: { source: 'environment' },
      });
      return { created: true, user: publicUser(user) };
    } catch (error) {
      if (duplicateUsername(error) && await repository.countUsers() > 0) return { created: false };
      throw error;
    }
  }

  async function ipAccessState(ipAddress) {
    const ip = normalizeAdminIp(ipAddress);
    if (!ip) return { status: 'ok', ipAddress: null };
    const manualBlock = await repository.isIpBlocked(ip);
    if (manualBlock) return { status: 'ip-blocked', ipAddress: ip, block: manualBlock };
    const state = await repository.getIpState(ip);
    const retryAfterSeconds = secondsUntil(state?.lockedUntil);
    if (retryAfterSeconds) return { status: 'ip-locked', ipAddress: ip, retryAfterSeconds };
    return { status: 'ok', ipAddress: ip };
  }

  async function recordFailedIp(ipAddress, username, settings, startedAt) {
    const ip = normalizeAdminIp(ipAddress);
    securityLog('admin.auth.failed', { username: username || null, ip });
    if (!ip) return null;
    const state = await repository.recordFailedIp(ip, new Date().toISOString(), settings);
    const retryAfterSeconds = secondsUntil(state?.lockedUntil);
    if (retryAfterSeconds) {
      securityLog('admin.auth.ip_lockout', {
        username: username || null,
        ip,
        attempts: state.failedLoginCount,
        lockoutSeconds: retryAfterSeconds,
      });
      await appendAudit({
        eventType: 'authentication', operationType: 'admin.ip-lockout', status: 'locked',
        durationMs: Date.now() - startedAt, ipAddress: ip, username: username || null,
        details: { failedLoginCount: state.failedLoginCount, retryAfterSeconds },
      });
    }
    return retryAfterSeconds;
  }

  async function authenticateCredentials(usernameValue, password, context = {}) {
    const startedAt = Date.now();
    const ipState = await ipAccessState(context.ipAddress);
    if (ipState.status !== 'ok') return ipState;
    const settings = await repository.getSecuritySettings();
    let username;
    try { username = normalizeAdminUsername(usernameValue); }
    catch { username = String(usernameValue ?? '').slice(0, 64); }

    const user = await repository.findUserByUsername(username);
    if (!user) {
      await burnUnknownPasswordCheck(password);
      const ipRetry = await recordFailedIp(ipState.ipAddress, username, settings, startedAt);
      await appendAudit({
        eventType: 'authentication', operationType: 'admin.login', status: ipRetry ? 'locked' : 'failed',
        durationMs: Date.now() - startedAt, ipAddress: ipState.ipAddress,
        username: username || null, details: { reason: 'invalid-credentials' },
      });
      return ipRetry
        ? { status: 'ip-locked', user: null, retryAfterSeconds: ipRetry }
        : { status: 'invalid', user: null };
    }

    const now = new Date();
    if (user.isBlocked) {
      const manualRetry = secondsUntil(user.manualBlockedUntil, now);
      if (!user.manualBlockedUntil || manualRetry) {
        await appendAudit({
          eventType: 'authentication', operationType: 'admin.login', status: 'blocked',
          durationMs: Date.now() - startedAt, ipAddress: ipState.ipAddress,
          userId: user.id, username: user.username,
          details: { reason: 'manual-block', retryAfterSeconds: manualRetry },
        });
        return { status: 'blocked', user: publicUser(user), retryAfterSeconds: manualRetry };
      }
      await repository.updateUser(user.id, {
        ...user,
        isBlocked: false,
        manualBlockedAt: null,
        manualBlockedUntil: null,
        manualBlockReason: null,
        manualBlockedBy: null,
      });
      user.isBlocked = false;
    }

    const accountRetry = secondsUntil(user.lockedUntil, now);
    if (accountRetry) {
      await appendAudit({
        eventType: 'authentication', operationType: 'admin.login', status: 'locked',
        durationMs: Date.now() - startedAt, ipAddress: ipState.ipAddress,
        userId: user.id, username: user.username,
        details: { retryAfterSeconds: accountRetry },
      });
      return { status: 'locked', user: publicUser(user), retryAfterSeconds: accountRetry };
    }

    if (!await verifyAdminPassword(password, user.passwordHash)) {
      const updated = await repository.recordFailedLogin(user.id, now.toISOString(), settings);
      const retryAfterSeconds = secondsUntil(updated?.lockedUntil, now);
      const ipRetry = await recordFailedIp(ipState.ipAddress, user.username, settings, startedAt);
      if (retryAfterSeconds) {
        securityLog('admin.auth.lockout', {
          username: user.username,
          ip: ipState.ipAddress,
          attempts: updated?.failedLoginCount ?? null,
          lockoutSeconds: retryAfterSeconds,
        });
      }
      await appendAudit({
        eventType: 'authentication', operationType: 'admin.login',
        status: retryAfterSeconds || ipRetry ? 'locked' : 'failed',
        durationMs: Date.now() - startedAt, ipAddress: ipState.ipAddress,
        userId: user.id, username: user.username,
        details: {
          reason: 'invalid-credentials', failedLoginCount: updated?.failedLoginCount ?? null,
          ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
          ...(ipRetry ? { ipRetryAfterSeconds: ipRetry } : {}),
        },
      });
      if (ipRetry) return { status: 'ip-locked', user: null, retryAfterSeconds: ipRetry };
      return retryAfterSeconds
        ? { status: 'locked', user: null, retryAfterSeconds }
        : { status: 'invalid', user: null };
    }

    await repository.clearIpFailures(ipState.ipAddress);
    const authenticated = await repository.recordSuccessfulLogin(user.id, now.toISOString()) ?? user;
    if (context.recordLogin !== false) {
      await appendAudit({
        eventType: 'authentication', operationType: 'admin.login', status: 'succeeded',
        durationMs: Date.now() - startedAt, ipAddress: ipState.ipAddress,
        userId: user.id, username: user.username, details: { method: context.method ?? 'password' },
      });
    }
    return { status: 'success', user: publicUser(authenticated), rawUser: authenticated };
  }

  async function authenticate(authorization, context = {}) {
    const credentials = parseBasicAuthorization(authorization);
    if (credentials.status === 'missing') return { status: 'missing', user: null };
    if (credentials.status !== 'credentials') return { status: 'invalid', user: null };
    return authenticateCredentials(credentials.username, credentials.password, {
      ...context, method: 'basic', recordLogin: context.recordLogin ?? false,
    });
  }

  async function login(payload, context = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const result = await authenticateCredentials(payload.username, payload.password, {
      ...context, method: 'session', recordLogin: true,
    });
    if (result.status !== 'success') return result;
    const settings = await repository.getSecuritySettings();
    const token = crypto.randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + settings.sessionAbsoluteSeconds * 1000).toISOString();
    const session = await repository.createSession({
      userId: result.user.id,
      tokenHash: tokenHash(token),
      expiresAt,
      ipAddress: normalizeAdminIp(context.ipAddress),
      userAgent: String(context.userAgent ?? '').slice(0, 1000) || null,
    });
    return { status: 'success', user: result.user, token, sessionId: session.id, expiresAt };
  }

  async function authenticateSession(token, context = {}) {
    if (!token) return { status: 'missing', user: null };
    const ipState = await ipAccessState(context.ipAddress);
    if (ipState.status !== 'ok') return ipState;
    const session = await repository.findSession(tokenHash(token));
    if (!session) return { status: 'invalid', user: null };
    const now = new Date();
    const settings = await repository.getSecuritySettings();
    const absoluteExpired = new Date(session.sessionExpiresAt) <= now;
    const idleExpired = new Date(session.sessionLastSeenAt).valueOf() + settings.sessionIdleSeconds * 1000 <= now.valueOf();
    if (absoluteExpired || idleExpired) {
      await repository.revokeSessionByHash(tokenHash(token));
      return { status: 'expired', user: null };
    }
    const user = publicUser(session);
    if (user.isBlocked) {
      const retryAfterSeconds = secondsUntil(user.manualBlockedUntil, now);
      if (!user.manualBlockedUntil || retryAfterSeconds) {
        return { status: 'blocked', user, retryAfterSeconds };
      }
    }
    if (now.valueOf() - new Date(session.sessionLastSeenAt).valueOf() > 60000) {
      await repository.touchSession(session.sessionId, now.toISOString());
    }
    return {
      status: 'success', user, sessionId: session.sessionId,
      authMethod: 'session', token,
    };
  }

  async function authenticateRequest({ authorization, sessionToken, ...context }) {
    if (sessionToken) {
      const sessionResult = await authenticateSession(sessionToken, context);
      if (sessionResult.status === 'success') return sessionResult;
      if (sessionResult.status !== 'invalid' && sessionResult.status !== 'expired') return sessionResult;
    }
    const basicResult = await authenticate(authorization, context);
    return basicResult.status === 'success'
      ? { ...basicResult, authMethod: 'basic', sessionId: null }
      : basicResult;
  }

  async function logout(token) {
    if (token) await repository.revokeSessionByHash(tokenHash(token));
  }

  async function createUser(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const allowed = new Set([
      'username', 'displayName', 'email', 'password',
      'canManageData', 'canManageInterface', 'canManageUsers', 'canViewAudit', 'canManageSecurity',
    ]);
    const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
    if (unknown.length) throw new AdminSecurityValidationError(`Request body contains unsupported properties: ${unknown.join(', ')}`);
    const username = normalizeAdminUsername(payload.username);
    const temporaryPassword = payload.password ? null : generateTemporaryPassword();
    const password = payload.password ?? temporaryPassword;
    const user = {
      username,
      displayName: normalizeAdminDisplayName(payload.displayName, username),
      email: normalizeAdminEmail(payload.email),
      passwordHash: await hashAdminPassword(password),
      canManageData: booleanField(payload.canManageData, 'canManageData'),
      canManageInterface: booleanField(payload.canManageInterface, 'canManageInterface'),
      canManageUsers: booleanField(payload.canManageUsers, 'canManageUsers'),
      canViewAudit: booleanField(payload.canViewAudit, 'canViewAudit'),
      canManageSecurity: booleanField(payload.canManageSecurity, 'canManageSecurity'),
      isSuperuser: false,
      isBootstrap: false,
      mustChangePassword: Boolean(temporaryPassword),
    };
    try {
      const created = publicUser(await repository.createUser(user));
      return { user: created, temporaryPassword };
    } catch (error) {
      if (duplicateUsername(error)) throw new AdminSecurityValidationError('A user with this username already exists');
      throw error;
    }
  }

  async function updateUser(userId, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const allowed = new Set([
      'displayName', 'email', 'canManageData', 'canManageInterface',
      'canManageUsers', 'canViewAudit', 'canManageSecurity',
    ]);
    const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
    if (unknown.length) throw new AdminSecurityValidationError(`Request body contains unsupported properties: ${unknown.join(', ')}`);
    const current = await repository.getUser(userId);
    if (!current) return null;
    const protectedUser = current.isBootstrap || current.isSuperuser;
    const next = {
      ...current,
      displayName: normalizeAdminDisplayName(payload.displayName, current.displayName ?? current.username),
      email: payload.email === undefined ? current.email : normalizeAdminEmail(payload.email),
      canManageData: protectedUser ? true : booleanField(payload.canManageData, 'canManageData', current.canManageData),
      canManageInterface: protectedUser ? true : booleanField(payload.canManageInterface, 'canManageInterface', current.canManageInterface),
      canManageUsers: protectedUser ? true : booleanField(payload.canManageUsers, 'canManageUsers', current.canManageUsers),
      canViewAudit: protectedUser ? true : booleanField(payload.canViewAudit, 'canViewAudit', current.canViewAudit),
      canManageSecurity: protectedUser ? true : booleanField(payload.canManageSecurity, 'canManageSecurity', current.canManageSecurity),
    };
    return publicUser(await repository.updateUser(userId, next));
  }

  async function deleteUser(userId, actorId) {
    const current = await repository.getUser(userId);
    if (!current) return null;
    if (current.isBootstrap) throw new AdminSecurityValidationError('Bootstrap administrator cannot be deleted');
    if (userId === actorId) throw new AdminSecurityValidationError('You cannot delete your active account');
    await repository.revokeUserSessions(userId);
    return publicUser(await repository.deleteUser(userId));
  }

  async function resetTemporaryPassword(userId) {
    const current = await repository.getUser(userId);
    if (!current) return null;
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashAdminPassword(temporaryPassword);
    const user = await repository.updatePassword(userId, passwordHash, true);
    await repository.revokeUserSessions(userId);
    return { user: publicUser(user), temporaryPassword };
  }

  async function blockUser(userId, payload, actor) {
    const current = await repository.getUser(userId);
    if (!current) return null;
    if (current.isBootstrap) throw new AdminSecurityValidationError('Bootstrap administrator cannot be manually blocked');
    if (actor?.id === userId) throw new AdminSecurityValidationError('You cannot manually block your active account');
    const durationSeconds = normalizeDurationSeconds(payload?.durationSeconds);
    const now = new Date();
    const next = {
      ...current,
      isBlocked: true,
      manualBlockedAt: now.toISOString(),
      manualBlockedUntil: durationSeconds
        ? new Date(now.valueOf() + durationSeconds * 1000).toISOString()
        : null,
      manualBlockReason: normalizeReason(payload?.reason),
      manualBlockedBy: actor?.id ?? null,
    };
    const user = await repository.updateUser(userId, next);
    await repository.revokeUserSessions(userId);
    return publicUser(user);
  }

  async function unblockUser(userId) {
    const current = await repository.getUser(userId);
    if (!current) return null;
    return publicUser(await repository.updateUser(userId, {
      ...current,
      isBlocked: false,
      manualBlockedAt: null,
      manualBlockedUntil: null,
      manualBlockReason: null,
      manualBlockedBy: null,
    }));
  }

  async function updateOwnProfile(userId, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const unknown = Object.keys(payload).filter((key) => !['displayName', 'email'].includes(key));
    if (unknown.length) throw new AdminSecurityValidationError(`Request body contains unsupported properties: ${unknown.join(', ')}`);
    const current = await repository.getUser(userId);
    if (!current) return null;
    return publicUser(await repository.updateProfile(userId, {
      displayName: normalizeAdminDisplayName(payload.displayName, current.displayName ?? current.username),
      email: payload.email === undefined ? current.email : normalizeAdminEmail(payload.email),
    }));
  }

  async function changeOwnPassword(userId, payload, currentSessionId = null) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const unknown = Object.keys(payload).filter((key) => !['currentPassword', 'newPassword'].includes(key));
    if (unknown.length) throw new AdminSecurityValidationError(`Request body contains unsupported properties: ${unknown.join(', ')}`);
    const current = await repository.getAuthUser(userId);
    if (!current) return null;
    if (!await verifyAdminPassword(payload.currentPassword, current.passwordHash)) {
      throw new AdminSecurityValidationError('Current password is incorrect');
    }
    const passwordHash = await hashAdminPassword(payload.newPassword);
    const user = await repository.updatePassword(userId, passwordHash, false);
    await repository.revokeUserSessions(userId, currentSessionId);
    return publicUser(user);
  }

  async function saveAvatar(userId, mime, data) {
    if (!AVATAR_MIMES.has(mime)) throw new AdminSecurityValidationError('Avatar must be PNG, JPEG or WebP');
    if (!Buffer.isBuffer(data) || data.length < 1 || data.length > AVATAR_MAX_BYTES) {
      throw new AdminSecurityValidationError(`Avatar must contain 1-${AVATAR_MAX_BYTES} bytes`);
    }
    return publicUser(await repository.saveAvatar(userId, mime, data));
  }

  async function createIpBlock(payload, actor, actorIp) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const ipAddress = normalizeAdminIp(payload.ipAddress);
    if (!ipAddress) throw new AdminSecurityValidationError('ipAddress is required');
    if (ipAddress === normalizeAdminIp(actorIp)) {
      throw new AdminSecurityValidationError('You cannot block the IP address of your current session');
    }
    const durationSeconds = normalizeDurationSeconds(payload.durationSeconds);
    return repository.createIpBlock({
      ipAddress,
      expiresAt: durationSeconds ? new Date(Date.now() + durationSeconds * 1000).toISOString() : null,
      blockedBy: actor?.id ?? null,
      reason: normalizeReason(payload.reason),
      sourceAuditId: (payload.sourceAuditId === null || payload.sourceAuditId === undefined)
        ? null
        : integerField(payload.sourceAuditId, 'sourceAuditId', 1, Number.MAX_SAFE_INTEGER),
    });
  }

  async function saveSecuritySettings(payload) {
    const settings = await repository.saveSecuritySettings(normalizeAdminSecuritySettings(payload));
    await repository.purgeAudit(settings.auditRetentionDays);
    return settings;
  }

  return {
    bootstrap,
    authenticate,
    authenticateRequest,
    login,
    logout,
    appendAudit,
    listUsers: () => repository.listUsers().then((users) => users.map(publicUser)),
    createUser,
    updateUser,
    deleteUser,
    resetTemporaryPassword,
    blockUser,
    unblockUser,
    updateOwnProfile,
    changeOwnPassword,
    getAvatar: (userId) => repository.getAvatar(userId),
    saveAvatar,
    clearAvatar: (userId) => repository.clearAvatar(userId).then(publicUser),
    listUserSessions: (userId) => repository.listUserSessions(userId),
    revokeSession: (userId, sessionId) => repository.revokeSessionById(userId, sessionId),
    revokeOtherSessions: (userId, sessionId) => repository.revokeUserSessions(userId, sessionId),
    getSecuritySettings: () => repository.getSecuritySettings(),
    saveSecuritySettings,
    listIpBlocks: () => repository.listIpBlocks(),
    createIpBlock,
    deleteIpBlock: (blockId) => repository.deleteIpBlock(blockId),
    listAudit: (options) => repository.listAudit(options),
    auditFacets: () => repository.auditFacets(),
  };
}
