import {
  createAdminAuditChangeSet,
  sanitizeAdminAuditData,
} from '../data/admin-audit-details.js';
import { serviceLog } from '../service-log.js';

const SESSION_COOKIE = 'dtpstat_admin_session';
const AUDIT_CHANGES_LOCAL = 'dtpstatAdminAuditChanges';
const AUDIT_DETAILS_LOCAL = 'dtpstatAdminAuditDetails';

function authorizationError(response, status, error, options = {}) {
  response.set('Cache-Control', 'no-store');
  if (options.challenge) {
    response.set('WWW-Authenticate', 'Basic realm="dtpstat-admin", charset="UTF-8"');
  }
  if (options.retryAfterSeconds) response.set('Retry-After', String(options.retryAfterSeconds));
  response.status(status).json({
    error,
    ...(options.code ? { code: options.code } : {}),
    ...(options.retryAfterSeconds ? { retryAfterSeconds: options.retryAfterSeconds } : {}),
  });
}

function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try { cookies.set(name, decodeURIComponent(value)); }
    catch { cookies.set(name, value); }
  }
  return cookies;
}

export function adminSessionToken(request) {
  return parseCookies(request.headers?.cookie).get(SESSION_COOKIE) ?? null;
}

export function adminSessionCookieName() {
  return SESSION_COOKIE;
}

/** @param {import('express').Request | import('node:http').IncomingMessage} request */
export function adminClientIp(request) {
  const expressIp = 'ip' in request && typeof request.ip === 'string' ? request.ip : null;
  const socketIp = request.socket?.remoteAddress ?? null;
  const value = (expressIp || socketIp || '').trim();
  if (!value) return null;
  return (value.startsWith('::ffff:') ? value.slice(7) : value).slice(0, 128);
}

function hasPermission(user, permission) {
  if (!user) return false;
  if (user.isSuperuser) return true;
  if (permission === 'any' || permission === 'profile') return true;
  if (permission === 'data') return Boolean(user.canManageData);
  if (permission === 'interface') return Boolean(user.canManageInterface);
  if (permission === 'users') return Boolean(user.canManageUsers);
  if (permission === 'audit') return Boolean(user.canViewAudit);
  if (permission === 'security') return Boolean(user.canManageSecurity);
  if (permission === 'superuser') return false;
  return false;
}

function csrfAllowed(request, authMethod) {
  if (authMethod !== 'session' || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  const fetchSite = request.get?.('sec-fetch-site');
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;
  const origin = request.get?.('origin');
  if (!origin) return true;
  try {
    const expected = `${request.protocol}://${request.get('host')}`;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

/**
 * Session cookies are preferred for the interactive web admin. DB-backed Basic
 * Auth remains accepted for scripts and compatibility clients.
 */
export function createAdminAuthorization(securityService) {
  const authenticateRequest = async (request) => securityService.authenticateRequest({
    authorization: request.get?.('authorization') ?? request.headers?.authorization,
    sessionToken: adminSessionToken(request),
    ipAddress: adminClientIp(request),
    userAgent: request.get?.('user-agent') ?? request.headers?.['user-agent'],
  });

  const middleware = (permission = 'any', options = {}) =>
    async (request, response, next) => {
      try {
        const result = await authenticateRequest(request);
        if (result.status === 'missing' || result.status === 'invalid' || result.status === 'expired') {
          authorizationError(response, 401, 'Authentication required', {
            challenge: Boolean(request.get?.('authorization')),
          });
          return;
        }
        if (result.status === 'ip-blocked') {
          authorizationError(response, 403, 'This IP address is blocked by an administrator');
          return;
        }
        if (result.status === 'ip-locked') {
          authorizationError(response, 429, 'Too many failed login attempts from this IP address', {
            retryAfterSeconds: result.retryAfterSeconds,
          });
          return;
        }
        if (result.status === 'blocked') {
          authorizationError(response, 403, 'Administrator account is blocked', {
            retryAfterSeconds: result.retryAfterSeconds,
          });
          return;
        }
        if (result.status === 'locked') {
          authorizationError(response, 423, 'Administrator account is temporarily locked', {
            retryAfterSeconds: result.retryAfterSeconds,
          });
          return;
        }
        if (result.status !== 'success') {
          authorizationError(response, 401, 'Invalid username or password', { challenge: true });
          return;
        }
        if (!csrfAllowed(request, result.authMethod)) {
          authorizationError(response, 403, 'Cross-site administrative request rejected');
          return;
        }
        const user = result.user;
        if (user.mustChangePassword && !options.allowPasswordChangePending) {
          authorizationError(response, 428, 'Password change required', {
            code: 'password_change_required',
          });
          return;
        }
        if (!hasPermission(user, permission)) {
          authorizationError(response, 403, 'Administrator permission is required');
          return;
        }
        request.adminUser = user;
        request.adminSessionId = result.sessionId ?? null;
        request.adminAuthMethod = result.authMethod ?? 'basic';
        next();
      } catch (error) {
        next(error);
      }
    };

  const requireAdminEntry = async (request, response, next) => {
    try {
      const result = await authenticateRequest(request);
      if (result.status !== 'success') {
        response.redirect(302, '/admin/login.html');
        return;
      }
      request.adminUser = result.user;
      request.adminSessionId = result.sessionId ?? null;
      request.adminAuthMethod = result.authMethod ?? 'basic';
      next();
    } catch (error) {
      next(error);
    }
  };

  return {
    requireAny: middleware('any'),
    requireAdminEntry,
    requireProfile: middleware('profile', { allowPasswordChangePending: true }),
    requireData: middleware('data'),
    requireInterface: middleware('interface'),
    requireUsers: middleware('users'),
    requireAudit: middleware('audit'),
    requireSecurity: middleware('security'),
    requireSuperuser: middleware('superuser'),

    async authenticateUpgrade(request, permission = 'data') {
      const result = await securityService.authenticateRequest({
        authorization: request.headers.authorization,
        sessionToken: adminSessionToken(request),
        ipAddress: adminClientIp(request),
        userAgent: request.headers['user-agent'],
      });
      if (result.status !== 'success') return result;
      if (result.user.mustChangePassword) {
        return { status: 'password-change-required', user: result.user };
      }
      return hasPermission(result.user, permission)
        ? result
        : { status: 'forbidden', user: result.user };
    },
  };
}

export function recordAdminOperationChanges(response, before, after, options = {}) {
  response.locals ??= {};
  const changeSet = createAdminAuditChangeSet(before, after, options);
  response.locals[AUDIT_CHANGES_LOCAL] = changeSet;
  return changeSet;
}

export function recordAdminOperationDetails(response, details) {
  response.locals ??= {};
  const current = response.locals[AUDIT_DETAILS_LOCAL] ?? {};
  response.locals[AUDIT_DETAILS_LOCAL] = {
    ...current,
    ...sanitizeAdminAuditData(details ?? {}),
  };
}

function mayRecordConcreteChanges(operationType) {
  return !operationType.startsWith('security.') && !operationType.startsWith('profile.');
}

export function createAdminOperationAudit(securityService, operationType) {
  return function auditAdminOperation(request, response, next) {
    const startedAt = Date.now();
    let recorded = false;
    const record = () => {
      if (recorded || !request.adminUser) return;
      recorded = true;
      const status = response.statusCode >= 200 && response.statusCode < 400 ? 'succeeded' : 'failed';
      const allowChanges = mayRecordConcreteChanges(operationType);
      const changeSet = allowChanges ? response.locals?.[AUDIT_CHANGES_LOCAL] : null;
      const extraDetails = allowChanges ? response.locals?.[AUDIT_DETAILS_LOCAL] : null;
      const details = {
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        ...(extraDetails ?? {}),
        ...(changeSet?.changes?.length ? { changes: changeSet.changes } : {}),
        ...(changeSet?.changesTruncated ? { changesTruncated: true } : {}),
      };
      const durationMs = Math.max(0, Date.now() - startedAt);
      const ipAddress = adminClientIp(request);
      serviceLog(status === 'succeeded' ? 'info' : 'warning', 'admin.operation', {
        operationType,
        status,
        durationMs,
        ipAddress,
        userId: request.adminUser.id,
        username: request.adminUser.username,
        ...details,
      });
      void securityService.appendAudit({
        eventType: 'operation', operationType, status,
        durationMs,
        ipAddress,
        userId: request.adminUser.id,
        username: request.adminUser.username,
        details,
      }).catch((error) => console.error('Admin audit write failed', error));
    };
    response.once('finish', record);
    response.once('close', record);
    next();
  };
}
