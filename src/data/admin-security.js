import { timingSafeEqual } from 'node:crypto';
import {
  createAdminPasswordHash,
  createAdminSessionToken,
  hashAdminSessionToken,
  verifyAdminPassword,
} from './admin-security-crypto.js';

export class AdminSecurityValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminSecurityValidationError';
  }
}

export class AdminAuthenticationError extends Error {
  constructor(message, status = 401, details = {}) {
    super(message);
    this.name = 'AdminAuthenticationError';
    this.status = status;
    Object.assign(this, details);
  }
}

const AVATAR_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const AVATAR_MAX_BYTES = 256 * 1024;
const USERNAME_PATTERN = /^[A-Za-z0-9._@+-]{1,128}$/;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 1024;

function publicUser(user) {
  if (!user) return null;
  return {
    id: Number(user.id),
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    canManageData: Boolean(user.canManageData),
    canManageInterface: Boolean(user.canManageInterface),
    canManageUsers: Boolean(user.canManageUsers),
    canViewAudit: Boolean(user.canViewAudit),
    canManageSecurity: Boolean(user.canManageSecurity),
    isSuperuser: Boolean(user.isSuperuser),
    isBootstrap: Boolean(user.isBootstrap),
    isBlocked: Boolean(user.isBlocked),
    mustChangePassword: Boolean(user.mustChangePassword),
    hasAvatar: Boolean(user.hasAvatar),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    passwordChangedAt: user.passwordChangedAt,
    manualBlockedAt: user.manualBlockedAt,
    manualBlockedUntil: user.manualBlockedUntil,
    manualBlockReason: user.manualBlockReason,
  };
}

function normalizeAdminUsername(value) {
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError('username must be a string');
  }
  const normalized = value.trim().normalize('NFC');
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new AdminSecurityValidationError(
      'username must contain 1-128 letters, digits or . _ @ + -',
    );
  }
  return normalized;
}

function normalizeAdminPassword(value, { bootstrap = false } = {}) {
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError('password must be a string');
  }
  if (bootstrap) {
    if (!value.length) throw new AdminSecurityValidationError('password must not be empty');
    return value;
  }
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    throw new AdminSecurityValidationError(
      `password must contain ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`,
    );
  }
  return value;
}

function normalizeDisplayName(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError('displayName must be a string or null');
  }
  const normalized = value.trim().replace(/\s+/g, ' ').normalize('NFC');
  if (!normalized || normalized.length > 160) {
    throw new AdminSecurityValidationError('displayName must contain 1-160 characters');
  }
  return normalized;
}

function normalizeEmail(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new AdminSecurityValidationError('email must be a string or null');
  }
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (!/^.{1,254}@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new AdminSecurityValidationError('email is not valid');
  }
  return normalized;
}

function booleanField(value, name, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new AdminSecurityValidationError(`${name} must be boolean`);
  }
  return value;
}

function integerField(value, name, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AdminSecurityValidationError(`${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function normalizeDurationSeconds(value) {
  if (value === undefined || value === null || value === '') return null;
  return integerField(value, 'durationSeconds', 1, 10 * 365 * 24 * 60 * 60);
}

function normalizeReason(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new AdminSecurityValidationError('reason must be a string');
  const normalized = value.trim().normalize('NFC');
  if (normalized.length > 1000) throw new AdminSecurityValidationError('reason is too long');
  return normalized || null;
}

function normalizeAdminIp(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 64 || /[^0-9a-fA-F:.]/.test(normalized)) return null;
  return normalized;
}

function allPermissions(user) {
  return {
    canManageData: Boolean(user?.isSuperuser || user?.canManageData),
    canManageInterface: Boolean(user?.isSuperuser || user?.canManageInterface),
    canManageUsers: Boolean(user?.isSuperuser || user?.canManageUsers),
    canViewAudit: Boolean(user?.isSuperuser || user?.canViewAudit),
    canManageSecurity: Boolean(user?.isSuperuser || user?.canManageSecurity),
  };
}

function retrySeconds(until, now = Date.now()) {
  if (!until) return 0;
  return Math.max(1, Math.ceil((new Date(until).getTime() - now) / 1000));
}

function normalizeAdminSecuritySettings(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AdminSecurityValidationError('Request body must be a JSON object');
  }
  return {
    maxFailedAttempts: integerField(payload.maxFailedAttempts, 'maxFailedAttempts', 1, 100),
    failureWindowSeconds: integerField(payload.failureWindowSeconds, 'failureWindowSeconds', 1, 86400),
    lockoutSeconds: integerField(payload.lockoutSeconds, 'lockoutSeconds', 1, 604800),
    ipMaxFailedAttempts: integerField(payload.ipMaxFailedAttempts, 'ipMaxFailedAttempts', 1, 1000),
    ipFailureWindowSeconds: integerField(payload.ipFailureWindowSeconds, 'ipFailureWindowSeconds', 1, 86400),
    ipLockoutSeconds: integerField(payload.ipLockoutSeconds, 'ipLockoutSeconds', 1, 604800),
    sessionIdleSeconds: integerField(payload.sessionIdleSeconds, 'sessionIdleSeconds', 60, 604800),
    sessionAbsoluteSeconds: integerField(payload.sessionAbsoluteSeconds, 'sessionAbsoluteSeconds', 300, 2592000),
    auditRetentionDays: integerField(payload.auditRetentionDays, 'auditRetentionDays', 0, 3650),
  };
}

/**
 * @param {ReturnType<import('../db/admin-security-repository.js').createAdminSecurityRepository>} repository
 * @param {{ bootstrapUsername?: string | null, bootstrapPassword?: string | null }} bootstrapConfig
 */
export function createAdminSecurityService(repository, bootstrapConfig = {}) {
  const dummyPasswordHashPromise = createAdminPasswordHash('dummy-admin-password-for-timing-only');

  async function bootstrap() {
    const count = await repository.countUsers();
    if (count > 0) return null;
    if (!bootstrapConfig.bootstrapUsername || !bootstrapConfig.bootstrapPassword) {
      throw new Error(
        'ADMIN_USERS is empty and IMPORT_API_USERNAME/IMPORT_API_PASSWORD are not configured',
      );
    }
    const username = normalizeAdminUsername(bootstrapConfig.bootstrapUsername);
    const password = normalizeAdminPassword(bootstrapConfig.bootstrapPassword, { bootstrap: true });
    const passwordHash = await createAdminPasswordHash(password);
    return repository.createBootstrapUser({ username, passwordHash });
  }

  async function authenticate(usernameValue, passwordValue, ipAddress, userAgent = null) {
    const settings = await repository.getSecuritySettings();
    const username = typeof usernameValue === 'string' ? usernameValue.trim().normalize('NFC') : '';
    const password = typeof passwordValue === 'string' ? passwordValue : '';
    const ip = normalizeAdminIp(ipAddress);

    if (ip) {
      const manualIpBlock = await repository.findActiveIpBlock(ip);
      if (manualIpBlock) {
        return {
          status: 'ip-blocked',
          block: manualIpBlock,
          retryAfterSeconds: retrySeconds(manualIpBlock.expiresAt),
        };
      }
      const ipState = await repository.getIpLoginState(ip);
      if (ipState?.lockedUntil && new Date(ipState.lockedUntil).getTime() > Date.now()) {
        return {
          status: 'ip-locked',
          retryAfterSeconds: retrySeconds(ipState.lockedUntil),
        };
      }
    }

    const user = username ? await repository.findUserByUsername(username) : null;
    if (user?.isBlocked) {
      if (!user.manualBlockedUntil || new Date(user.manualBlockedUntil).getTime() > Date.now()) {
        return {
          status: 'blocked',
          user: publicUser(user),
          retryAfterSeconds: retrySeconds(user.manualBlockedUntil),
        };
      }
      await repository.clearExpiredManualUserBlock(user.id);
    }
    if (user?.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      return {
        status: 'locked',
        user: publicUser(user),
        retryAfterSeconds: retrySeconds(user.lockedUntil),
      };
    }

    const passwordHash = user?.passwordHash ?? await dummyPasswordHashPromise;
    const passwordValid = await verifyAdminPassword(password, passwordHash);
    if (!user || !passwordValid) {
      if (user) {
        await repository.recordUserLoginFailure(user.id, settings);
      }
      if (ip) {
        await repository.recordIpLoginFailure(ip, settings);
      }
      return { status: 'invalid' };
    }

    await repository.recordSuccessfulLogin(user.id, ip);
    return {
      status: 'success',
      user: publicUser({ ...user, ...allPermissions(user) }),
      ipAddress: ip,
      userAgent,
    };
  }

  async function login(payload, requestMeta = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const auth = await authenticate(
      payload.username,
      payload.password,
      requestMeta.ipAddress,
      requestMeta.userAgent,
    );
    if (auth.status !== 'success') return auth;
    const settings = await repository.getSecuritySettings();
    const token = createAdminSessionToken();
    const tokenHash = hashAdminSessionToken(token);
    const session = await repository.createSession({
      userId: auth.user.id,
      tokenHash,
      ipAddress: auth.ipAddress,
      userAgent: requestMeta.userAgent,
      absoluteSeconds: settings.sessionAbsoluteSeconds,
    });
    return {
      ...auth,
      token,
      sessionId: Number(session.id),
      expiresAt: session.expiresAt,
    };
  }

  async function authenticateSession(token, requestMeta = {}) {
    if (!token) return { status: 'invalid' };
    const settings = await repository.getSecuritySettings();
    const tokenHash = hashAdminSessionToken(token);
    const session = await repository.findSessionByTokenHash(tokenHash);
    if (!session) return { status: 'invalid' };
    const now = Date.now();
    if (
      new Date(session.expiresAt).getTime() <= now ||
      new Date(session.lastSeenAt).getTime() + settings.sessionIdleSeconds * 1000 <= now
    ) {
      await repository.revokeSession(session.id);
      return { status: 'invalid' };
    }
    if (session.user?.isBlocked || (
      session.user?.lockedUntil && new Date(session.user.lockedUntil).getTime() > now
    )) {
      await repository.revokeSession(session.id);
      return { status: 'blocked' };
    }
    const ip = normalizeAdminIp(requestMeta.ipAddress);
    if (ip) {
      const manualIpBlock = await repository.findActiveIpBlock(ip);
      if (manualIpBlock) return { status: 'ip-blocked', block: manualIpBlock };
    }
    await repository.touchSession(session.id);
    return {
      status: 'success',
      user: publicUser({ ...session.user, ...allPermissions(session.user) }),
      sessionId: Number(session.id),
      authMethod: 'session',
    };
  }

  async function authenticateBasic(header, requestMeta = {}) {
    if (!header?.startsWith('Basic ')) return { status: 'missing' };
    let decoded;
    try {
      decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    } catch {
      return { status: 'invalid' };
    }
    const separator = decoded.indexOf(':');
    if (separator < 0) return { status: 'invalid' };
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    const result = await authenticate(
      username,
      password,
      requestMeta.ipAddress,
      requestMeta.userAgent,
    );
    if (result.status === 'success') result.authMethod = 'basic';
    return result;
  }

  async function authenticateRequest({ authorization, sessionToken, ipAddress, userAgent }) {
    if (sessionToken) {
      const session = await authenticateSession(sessionToken, { ipAddress, userAgent });
      if (session.status !== 'invalid') return session;
    }
    return authenticateBasic(authorization, { ipAddress, userAgent });
  }

  async function logout(token) {
    if (!token) return;
    const tokenHash = hashAdminSessionToken(token);
    const session = await repository.findSessionByTokenHash(tokenHash);
    if (session) await repository.revokeSession(session.id);
  }

  async function appendAudit(payload) {
    return repository.appendAudit(payload);
  }

  async function createUser(payload, actor) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const username = normalizeAdminUsername(payload.username);
    const password = normalizeAdminPassword(payload.password);
    const passwordHash = await createAdminPasswordHash(password);
    const user = await repository.createUser({
      username,
      passwordHash,
      displayName: normalizeDisplayName(payload.displayName, username),
      email: normalizeEmail(payload.email),
      canManageData: booleanField(payload.canManageData, 'canManageData'),
      canManageInterface: booleanField(payload.canManageInterface, 'canManageInterface'),
      canManageUsers: booleanField(payload.canManageUsers, 'canManageUsers'),
      canViewAudit: booleanField(payload.canViewAudit, 'canViewAudit'),
      canManageSecurity: booleanField(payload.canManageSecurity, 'canManageSecurity'),
      isSuperuser: actor?.isSuperuser && booleanField(payload.isSuperuser, 'isSuperuser'),
      mustChangePassword: booleanField(payload.mustChangePassword, 'mustChangePassword', true),
    });
    return publicUser(user);
  }

  async function updateUser(userId, payload, actor) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const existing = await repository.findUserById(userId);
    if (!existing) return null;
    if (existing.isBootstrap && !actor?.isBootstrap) {
      throw new AdminSecurityValidationError('Only the bootstrap administrator can edit the bootstrap account');
    }
    const next = {
      username: payload.username === undefined ? existing.username : normalizeAdminUsername(payload.username),
      displayName: payload.displayName === undefined
        ? existing.displayName
        : normalizeDisplayName(payload.displayName, existing.username),
      email: payload.email === undefined ? existing.email : normalizeEmail(payload.email),
      canManageData: payload.canManageData === undefined ? existing.canManageData : booleanField(payload.canManageData, 'canManageData'),
      canManageInterface: payload.canManageInterface === undefined ? existing.canManageInterface : booleanField(payload.canManageInterface, 'canManageInterface'),
      canManageUsers: payload.canManageUsers === undefined ? existing.canManageUsers : booleanField(payload.canManageUsers, 'canManageUsers'),
      canViewAudit: payload.canViewAudit === undefined ? existing.canViewAudit : booleanField(payload.canViewAudit, 'canViewAudit'),
      canManageSecurity: payload.canManageSecurity === undefined ? existing.canManageSecurity : booleanField(payload.canManageSecurity, 'canManageSecurity'),
      isSuperuser: payload.isSuperuser === undefined ? existing.isSuperuser : booleanField(payload.isSuperuser, 'isSuperuser'),
    };
    if (!actor?.isSuperuser && next.isSuperuser !== existing.isSuperuser) {
      throw new AdminSecurityValidationError('Only a superuser can change superuser status');
    }
    return publicUser(await repository.updateUser(userId, next));
  }

  async function deleteUser(userId, actor) {
    const existing = await repository.findUserById(userId);
    if (!existing) return null;
    if (existing.isBootstrap) throw new AdminSecurityValidationError('Bootstrap administrator cannot be deleted');
    if (Number(existing.id) === Number(actor?.id)) throw new AdminSecurityValidationError('You cannot delete your current account');
    await repository.deleteUser(userId);
    return publicUser(existing);
  }

  async function resetTemporaryPassword(userId, actor) {
    const existing = await repository.findUserById(userId);
    if (!existing) return null;
    if (existing.isBootstrap && !actor?.isBootstrap) {
      throw new AdminSecurityValidationError('Only the bootstrap administrator can reset bootstrap credentials');
    }
    const password = createAdminSessionToken();
    const passwordHash = await createAdminPasswordHash(password);
    const user = await repository.updatePassword(userId, passwordHash, true);
    await repository.revokeUserSessions(userId);
    return { user: publicUser(user), temporaryPassword: password };
  }

  async function blockUser(userId, payload, actor) {
    const existing = await repository.findUserById(userId);
    if (!existing) return null;
    if (existing.isBootstrap) throw new AdminSecurityValidationError('Bootstrap administrator cannot be manually blocked');
    if (Number(existing.id) === Number(actor?.id)) throw new AdminSecurityValidationError('You cannot block your current account');
    const durationSeconds = normalizeDurationSeconds(payload?.durationSeconds);
    return publicUser(await repository.blockUser(userId, {
      blockedUntil: durationSeconds ? new Date(Date.now() + durationSeconds * 1000).toISOString() : null,
      reason: normalizeReason(payload?.reason),
      blockedBy: actor?.id ?? null,
    }));
  }

  async function unblockUser(userId) {
    const existing = await repository.findUserById(userId);
    if (!existing) return null;
    await repository.unblockUser(userId);
    return publicUser(await repository.findUserById(userId));
  }

  async function updateOwnProfile(userId, payload) {
    const existing = await repository.findUserById(userId);
    if (!existing) return null;
    return publicUser(await repository.updateOwnProfile(userId, {
      displayName: payload.displayName === undefined
        ? existing.displayName
        : normalizeDisplayName(payload.displayName, existing.username),
      email: payload.email === undefined ? existing.email : normalizeEmail(payload.email),
    }));
  }

  async function changeOwnPassword(userId, currentPassword, newPassword) {
    const existing = await repository.findUserById(userId);
    if (!existing) return null;
    if (!await verifyAdminPassword(String(currentPassword ?? ''), existing.passwordHash)) {
      throw new AdminAuthenticationError('Current password is invalid', 401);
    }
    const password = normalizeAdminPassword(newPassword);
    const passwordHash = await createAdminPasswordHash(password);
    const user = await repository.updatePassword(userId, passwordHash, false);
    await repository.revokeUserSessions(userId);
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
      sourceAuditId: payload.sourceAuditId === null || payload.sourceAuditId === undefined
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
    revokeSession: (userId, sessionId) => repository.revokeOwnedSession(userId, sessionId),
    revokeOtherSessions: (userId, currentSessionId) => repository.revokeUserSessions(userId, currentSessionId),
    getSecuritySettings: () => repository.getSecuritySettings(),
    saveSecuritySettings,
    listIpBlocks: () => repository.listIpBlocks(),
    createIpBlock,
    deleteIpBlock: (id) => repository.deleteIpBlock(id),
    listAudit: (filters) => repository.listAudit(filters),
    auditFacets: () => repository.auditFacets(),
    publicUser,
  };
}
