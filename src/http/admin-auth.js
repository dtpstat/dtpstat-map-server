function authorizationError(response, status, error, options = {}) {
  response.set('Cache-Control', 'no-store');
  if (options.challenge) {
    response.set('WWW-Authenticate', 'Basic realm="dtpstat-admin", charset="UTF-8"');
  }
  if (options.retryAfterSeconds) {
    response.set('Retry-After', String(options.retryAfterSeconds));
  }
  response.status(status).json({
    error,
    ...(options.retryAfterSeconds
      ? { retryAfterSeconds: options.retryAfterSeconds }
      : {}),
  });
}

/** @param {import('express').Request | import('node:http').IncomingMessage} request */
export function adminClientIp(request) {
  const expressIp = 'ip' in request && typeof request.ip === 'string'
    ? request.ip
    : null;
  const socketIp = request.socket?.remoteAddress ?? null;
  return (expressIp || socketIp || '').slice(0, 128) || null;
}

/**
 * Central authorization policy for the admin HTML, API endpoints and WebSocket.
 * Authentication remains HTTP Basic for compatibility with existing scripts,
 * but credentials and roles are resolved from ADMIN_USERS instead of ENV.
 *
 * @param {ReturnType<import('../data/admin-security.js').createAdminSecurityService>} securityService
 */
export function createAdminAuthorization(securityService) {
  const middleware = (permission = 'any', { recordLogin = false } = {}) =>
    async (request, response, next) => {
      try {
        const result = await securityService.authenticate(
          request.get('authorization'),
          {
            ipAddress: adminClientIp(request),
            recordLogin,
          },
        );
        if (result.status === 'missing') {
          authorizationError(response, 401, 'Authentication required', { challenge: true });
          return;
        }
        if (result.status === 'invalid') {
          authorizationError(response, 401, 'Invalid username or password', { challenge: true });
          return;
        }
        if (result.status === 'blocked') {
          authorizationError(response, 403, 'Administrator account is blocked');
          return;
        }
        if (result.status === 'locked') {
          authorizationError(
            response,
            423,
            'Administrator account is temporarily locked',
            { retryAfterSeconds: result.retryAfterSeconds },
          );
          return;
        }

        const user = result.user;
        const allowed =
          permission === 'any' ||
          user.isSuperuser ||
          (permission === 'data' && user.canManageData) ||
          (permission === 'interface' && user.canManageInterface) ||
          (permission === 'superuser' && user.isSuperuser);
        if (!allowed) {
          authorizationError(response, 403, 'Administrator permission is required');
          return;
        }
        request.adminUser = user;
        next();
      } catch (error) {
        next(error);
      }
    };

  return {
    requireAny: middleware('any'),
    requireAdminEntry: middleware('any', { recordLogin: true }),
    requireData: middleware('data'),
    requireInterface: middleware('interface'),
    requireSuperuser: middleware('superuser'),

    async authenticateUpgrade(request, permission = 'data') {
      const result = await securityService.authenticate(
        request.headers.authorization,
        { ipAddress: adminClientIp(request) },
      );
      if (result.status !== 'success') return result;
      const user = result.user;
      const allowed =
        user.isSuperuser ||
        permission === 'any' ||
        (permission === 'data' && user.canManageData) ||
        (permission === 'interface' && user.canManageInterface);
      return allowed
        ? result
        : { status: 'forbidden', user };
    },
  };
}

/**
 * Audit a synchronous HTTP admin operation. Long-running data tasks are audited
 * by the task manager when the actual background operation reaches a terminal state.
 *
 * @param {ReturnType<import('../data/admin-security.js').createAdminSecurityService>} securityService
 * @param {string} operationType
 */
export function createAdminOperationAudit(securityService, operationType) {
  return function auditAdminOperation(request, response, next) {
    const startedAt = Date.now();
    let recorded = false;
    const record = () => {
      if (recorded || !request.adminUser) return;
      recorded = true;
      const status = response.statusCode >= 200 && response.statusCode < 400
        ? 'succeeded'
        : 'failed';
      void securityService.appendAudit({
        eventType: 'operation',
        operationType,
        status,
        durationMs: Math.max(0, Date.now() - startedAt),
        ipAddress: adminClientIp(request),
        userId: request.adminUser.id,
        username: request.adminUser.username,
        details: {
          method: request.method,
          path: request.originalUrl,
          statusCode: response.statusCode,
        },
      }).catch((error) => {
        console.error('Admin audit write failed', error);
      });
    };
    response.once('finish', record);
    response.once('close', record);
    next();
  };
}
