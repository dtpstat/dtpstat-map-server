import { securityLog } from '../../service-log.js';
import {
  ADMIN_AVATAR_MAX_BYTES,
  ADMIN_AVATAR_MIMES,
  adminPasswordPolicy,
  AdminSecurityValidationError,
  booleanField,
  integerField,
  normalizeAdminDisplayName,
  normalizeAdminDurationSeconds,
  normalizeAdminEmail,
  normalizeAdminIp,
  normalizeAdminReason,
  normalizeAdminSecuritySettings,
  normalizeAdminUsername,
  publicAdminUser,
  secondsUntil,
} from './policy.js';
import {
  adminSessionTokenHash,
  burnUnknownPasswordCheck,
  generateAdminSessionToken,
  generateTemporaryPassword,
  hashAdminPassword,
  parseBasicAuthorization,
  verifyAdminPassword,
} from './credentials.js';

function duplicateUsername(error) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23505'
  );
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
        canEditOsm: true,
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
      return { created: true, user: publicAdminUser(user) };
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
        return { status: 'blocked', user: publicAdminUser(user), retryAfterSeconds: manualRetry };
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
      return { status: 'locked', user: publicAdminUser(user), retryAfterSeconds: accountRetry };
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
    return { status: 'success', user: publicAdminUser(authenticated), rawUser: authenticated };
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
    const token = generateAdminSessionToken();
    const expiresAt = new Date(Date.now() + settings.sessionAbsoluteSeconds * 1000).toISOString();
    const session = await repository.createSession({
      userId: result.user.id,
      tokenHash: adminSessionTokenHash(token),
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
    const session = await repository.findSession(adminSessionTokenHash(token));
    if (!session) return { status: 'invalid', user: null };
    const now = new Date();
    const settings = await repository.getSecuritySettings();
    const absoluteExpired = new Date(session.sessionExpiresAt) <= now;
    const idleExpired = new Date(session.sessionLastSeenAt).valueOf() + settings.sessionIdleSeconds * 1000 <= now.valueOf();
    if (absoluteExpired || idleExpired) {
      await repository.revokeSessionByHash(adminSessionTokenHash(token));
      return { status: 'expired', user: null };
    }
    const user = publicAdminUser(session);
    if (user.isBlocked) {
      const retryAfterSeconds = secondsUntil(user.manualBlockedUntil, now);
      if (!user.manualBlockedUntil || retryAfterSeconds) {
        return { status: 'blocked', user, retryAfterSeconds };
      }
    }
    let lastSeenAt = new Date(session.sessionLastSeenAt);
    const idleTouchIntervalMs = Math.min(
      60_000,
      Math.max(1_000, Math.floor(settings.sessionIdleSeconds * 1000 / 2)),
    );
    if (now.valueOf() - lastSeenAt.valueOf() >= idleTouchIntervalMs) {
      lastSeenAt = now;
      await repository.touchSession(session.sessionId, now.toISOString());
    }
    const absoluteExpiresAt = new Date(session.sessionExpiresAt);
    const idleExpiresAt = new Date(
      lastSeenAt.valueOf() + settings.sessionIdleSeconds * 1000,
    );
    const effectiveExpiresAt = new Date(Math.min(
      absoluteExpiresAt.valueOf(),
      idleExpiresAt.valueOf(),
    ));
    return {
      status: 'success',
      user,
      sessionId: session.sessionId,
      authMethod: 'session',
      token,
      sessionAbsoluteExpiresAt: absoluteExpiresAt.toISOString(),
      sessionIdleExpiresAt: idleExpiresAt.toISOString(),
      sessionEffectiveExpiresAt: effectiveExpiresAt.toISOString(),
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
    if (token) await repository.revokeSessionByHash(adminSessionTokenHash(token));
  }

  async function createUser(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AdminSecurityValidationError('Request body must be a JSON object');
    }
    const allowed = new Set([
      'username', 'displayName', 'email', 'password',
      'canManageData', 'canManageInterface', 'canEditOsm',
      'canManageUsers', 'canViewAudit', 'canManageSecurity',
    ]);
    const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
    if (unknown.length) throw new AdminSecurityValidationError(`Request body contains unsupported properties: ${unknown.join(', ')}`);
    const username = normalizeAdminUsername(payload.username);
    const policy = adminPasswordPolicy(await repository.getSecuritySettings());
    const temporaryPassword = payload.password ? null : generateTemporaryPassword(policy);
    const password = payload.password ?? temporaryPassword;
    const user = {
      username,
      displayName: normalizeAdminDisplayName(payload.displayName, username),
      email: normalizeAdminEmail(payload.email),
      passwordHash: await hashAdminPassword(password, { policy }),
      canManageData: booleanField(payload.canManageData, 'canManageData'),
      canManageInterface: booleanField(payload.canManageInterface, 'canManageInterface'),
      canEditOsm: booleanField(payload.canEditOsm, 'canEditOsm'),
      canManageUsers: booleanField(payload.canManageUsers, 'canManageUsers'),
      canViewAudit: booleanField(payload.canViewAudit, 'canViewAudit'),
      canManageSecurity: booleanField(payload.canManageSecurity, 'canManageSecurity'),
      isSuperuser: false,
      isBootstrap: false,
      mustChangePassword: Boolean(temporaryPassword),
    };
    try {
      const created = publicAdminUser(await repository.createUser(user));
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
      'displayName', 'email', 'canManageData', 'canManageInterface', 'canEditOsm',
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
      canEditOsm: protectedUser ? true : booleanField(payload.canEditOsm, 'canEditOsm', current.canEditOsm),
      canManageUsers: protectedUser ? true : booleanField(payload.canManageUsers, 'canManageUsers', current.canManageUsers),
      canViewAudit: protectedUser ? true : booleanField(payload.canViewAudit, 'canViewAudit', current.canViewAudit),
      canManageSecurity: protectedUser ? true : booleanField(payload.canManageSecurity, 'canManageSecurity', current.canManageSecurity),
    };
    return publicAdminUser(await repository.updateUser(userId, next));
  }

  async function deleteUser(userId, actorId) {
    const current = await repository.getUser(userId);
    if (!current) return null;
    if (current.isBootstrap) throw new AdminSecurityValidationError('Bootstrap administrator cannot be deleted');
    if (userId === actorId) throw new AdminSecurityValidationError('You cannot delete your active account');
    await repository.revokeUserSessions(userId);
    return publicAdminUser(await repository.deleteUser(userId));
  }

  async function resetTemporaryPassword(userId) {
    const current = await repository.getUser(userId);
    if (!current) return null;
    const policy = adminPasswordPolicy(await repository.getSecuritySettings());
    const temporaryPassword = generateTemporaryPassword(policy);
    const passwordHash = await hashAdminPassword(temporaryPassword, { policy });
    const user = await repository.updatePassword(userId, passwordHash, true);
    await repository.revokeUserSessions(userId);
    return { user: publicAdminUser(user), temporaryPassword };
  }

  async function blockUser(userId, payload, actor) {
    const current = await repository.getUser(userId);
    if (!current) return null;
    if (current.isBootstrap) throw new AdminSecurityValidationError('Bootstrap administrator cannot be manually blocked');
    if (actor?.id === userId) throw new AdminSecurityValidationError('You cannot manually block your active account');
    const durationSeconds = normalizeAdminDurationSeconds(payload?.durationSeconds);
    const now = new Date();
    const next = {
      ...current,
      isBlocked: true,
      manualBlockedAt: now.toISOString(),
      manualBlockedUntil: durationSeconds
        ? new Date(now.valueOf() + durationSeconds * 1000).toISOString()
        : null,
      manualBlockReason: normalizeAdminReason(payload?.reason),
      manualBlockedBy: actor?.id ?? null,
    };
    const user = await repository.updateUser(userId, next);
    await repository.revokeUserSessions(userId);
    return publicAdminUser(user);
  }

  async function unblockUser(userId) {
    const current = await repository.getUser(userId);
    if (!current) return null;
    return publicAdminUser(await repository.updateUser(userId, {
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
    return publicAdminUser(await repository.updateProfile(userId, {
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
    const policy = adminPasswordPolicy(await repository.getSecuritySettings());
    const passwordHash = await hashAdminPassword(payload.newPassword, { policy });
    const user = await repository.updatePassword(userId, passwordHash, false);
    await repository.revokeUserSessions(userId, currentSessionId);
    return publicAdminUser(user);
  }

  async function saveAvatar(userId, mime, data) {
    if (!ADMIN_AVATAR_MIMES.has(mime)) throw new AdminSecurityValidationError('Avatar must be PNG, JPEG or WebP');
    if (!Buffer.isBuffer(data) || data.length < 1 || data.length > ADMIN_AVATAR_MAX_BYTES) {
      throw new AdminSecurityValidationError(`Avatar must contain 1-${ADMIN_AVATAR_MAX_BYTES} bytes`);
    }
    return publicAdminUser(await repository.saveAvatar(userId, mime, data));
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
    const durationSeconds = normalizeAdminDurationSeconds(payload.durationSeconds);
    return repository.createIpBlock({
      ipAddress,
      expiresAt: durationSeconds ? new Date(Date.now() + durationSeconds * 1000).toISOString() : null,
      blockedBy: actor?.id ?? null,
      reason: normalizeAdminReason(payload.reason),
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
    getPasswordPolicy: async () =>
      adminPasswordPolicy(await repository.getSecuritySettings()),
    saveSecuritySettings,
    listIpBlocks: () => repository.listIpBlocks(),
    createIpBlock,
    deleteIpBlock: (blockId) => repository.deleteIpBlock(blockId),
    listAudit: (options) => repository.listAudit(options),
    auditFacets: () => repository.auditFacets(),
  };
}

