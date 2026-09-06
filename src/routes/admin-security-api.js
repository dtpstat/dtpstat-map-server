import express, { Router } from 'express';
import { AdminSecurityValidationError } from '../data/admin-security.js';
import {
  adminClientIp,
  adminSessionCookieName,
  adminSessionToken,
  createAdminOperationAudit,
} from '../http/admin-auth.js';

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validation(response, error) {
  if (!(error instanceof AdminSecurityValidationError)) return false;
  response.status(400).json({ error: error.message });
  return true;
}

function cookieValue(token, request, maxAgeSeconds) {
  const parts = [
    `${adminSessionCookieName()}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (request.secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(request) {
  return cookieValue('', request, 0);
}

function parseAuditFilters(query, { limitDefault = 200, limitMax = 500 } = {}) {
  const limit = query.limit === undefined ? limitDefault : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > limitMax ||
      !Number.isInteger(offset) || offset < 0 || offset > 1000000) {
    throw new AdminSecurityValidationError(
      `limit must be 1..${limitMax} and offset must be a non-negative integer`,
    );
  }
  const filters = { limit, offset };
  for (const key of ['eventType', 'operationType', 'status', 'username', 'ipAddress']) {
    if (query[key] !== undefined && String(query[key]).trim()) filters[key] = String(query[key]).trim();
  }
  for (const key of ['from', 'to']) {
    if (query[key] === undefined || !String(query[key]).trim()) continue;
    const date = new Date(String(query[key]));
    if (!Number.isFinite(date.valueOf())) throw new AdminSecurityValidationError(`${key} must be a valid date/time`);
    filters[key] = date.toISOString();
  }
  return filters;
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function createAdminSecurityRouter({ securityService, adminAuth, maxBodyBytes }) {
  const router = Router();
  const jsonBody = express.json({
    limit: Math.min(maxBodyBytes, 256 * 1024),
    strict: true,
    inflate: true,
    type: 'application/json',
  });
  const avatarBody = express.raw({
    limit: 256 * 1024,
    inflate: false,
    type: () => true,
  });
  const operationAudit = (type) => createAdminOperationAudit(securityService, type);

  router.post('/admin/login', jsonBody, async (request, response, next) => {
    try {
      const result = await securityService.login(request.body, {
        ipAddress: adminClientIp(request),
        userAgent: request.get('user-agent'),
      });
      if (result.status === 'ip-blocked') {
        response.status(403).json({ error: 'This IP address is blocked' });
        return;
      }
      if (result.status === 'ip-locked') {
        response.set('Retry-After', String(result.retryAfterSeconds ?? 1));
        response.status(429).json({
          error: 'Too many failed login attempts from this IP address',
          retryAfterSeconds: result.retryAfterSeconds,
        });
        return;
      }
      if (result.status === 'blocked') {
        response.status(403).json({ error: 'Administrator account is blocked' });
        return;
      }
      if (result.status === 'locked') {
        response.set('Retry-After', String(result.retryAfterSeconds ?? 1));
        response.status(423).json({
          error: 'Administrator account is temporarily locked',
          retryAfterSeconds: result.retryAfterSeconds,
        });
        return;
      }
      if (result.status !== 'success') {
        response.status(401).json({ error: 'Invalid username or password' });
        return;
      }
      const maxAge = Math.max(1, Math.floor((new Date(result.expiresAt).valueOf() - Date.now()) / 1000));
      response
        .set('Cache-Control', 'no-store')
        .set('Set-Cookie', cookieValue(result.token, request, maxAge))
        .json({ user: result.user });
    } catch (error) {
      if (validation(response, error)) return;
      next(error);
    }
  });

  router.post('/admin/logout', adminAuth.requireProfile, async (request, response, next) => {
    try {
      await securityService.logout(adminSessionToken(request));
      response
        .set('Cache-Control', 'no-store')
        .set('Set-Cookie', clearCookie(request))
        .status(204)
        .end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin/me', adminAuth.requireProfile, (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json({ user: request.adminUser, sessionId: request.adminSessionId });
  });

  router.patch(
    '/admin/profile',
    adminAuth.requireProfile,
    operationAudit('profile.update'),
    jsonBody,
    async (request, response, next) => {
      try {
        const user = await securityService.updateOwnProfile(request.adminUser.id, request.body);
        response.set('Cache-Control', 'no-store').json({ user });
      } catch (error) {
        if (validation(response, error)) return;
        next(error);
      }
    },
  );

  router.put(
    '/admin/profile/password',
    adminAuth.requireProfile,
    operationAudit('profile.password.change'),
    jsonBody,
    async (request, response, next) => {
      try {
        const user = await securityService.changeOwnPassword(
          request.adminUser.id,
          request.body,
          request.adminSessionId,
        );
        response.set('Cache-Control', 'no-store').json({ user });
      } catch (error) {
        if (validation(response, error)) return;
        next(error);
      }
    },
  );

  router.get('/admin/profile/avatar', adminAuth.requireProfile, async (request, response, next) => {
    try {
      const avatar = await securityService.getAvatar(request.adminUser.id);
      if (!avatar?.data) {
        response.status(404).end();
        return;
      }
      response.set('Cache-Control', 'private, max-age=60').type(avatar.mime).send(avatar.data);
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/admin/profile/avatar',
    adminAuth.requireProfile,
    operationAudit('profile.avatar.update'),
    avatarBody,
    async (request, response, next) => {
      try {
        const user = await securityService.saveAvatar(
          request.adminUser.id,
          request.get('content-type')?.split(';')[0]?.trim(),
          request.body,
        );
        response.set('Cache-Control', 'no-store').json({ user });
      } catch (error) {
        if (validation(response, error)) return;
        next(error);
      }
    },
  );

  router.delete(
    '/admin/profile/avatar',
    adminAuth.requireProfile,
    operationAudit('profile.avatar.delete'),
    async (request, response, next) => {
      try {
        const user = await securityService.clearAvatar(request.adminUser.id);
        response.set('Cache-Control', 'no-store').json({ user });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/admin/profile/sessions', adminAuth.requireProfile, async (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store').json({
        currentSessionId: request.adminSessionId,
        sessions: await securityService.listUserSessions(request.adminUser.id),
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/admin/profile/sessions/others', adminAuth.requireProfile, async (request, response, next) => {
    try {
      const revoked = await securityService.revokeOtherSessions(
        request.adminUser.id,
        request.adminSessionId,
      );
      response.json({ revoked });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/admin/profile/sessions/:sessionId', adminAuth.requireProfile, async (request, response, next) => {
    const sessionId = parsePositiveInteger(request.params.sessionId);
    if (!sessionId) {
      response.status(400).json({ error: 'sessionId must be a positive integer' });
      return;
    }
    try {
      const revoked = await securityService.revokeSession(request.adminUser.id, sessionId);
      if (!revoked) {
        response.status(404).json({ error: 'Session not found' });
        return;
      }
      const deletingCurrent = request.adminSessionId === sessionId;
      if (deletingCurrent) response.set('Set-Cookie', clearCookie(request));
      response.json({ revoked: true, loggedOut: deletingCurrent });
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin/security/users', adminAuth.requireUsers, async (_request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store').json({ users: await securityService.listUsers() });
    } catch (error) { next(error); }
  });

  router.post(
    '/admin/security/users',
    adminAuth.requireUsers,
    operationAudit('security.user.create'),
    jsonBody,
    async (request, response, next) => {
      try {
        const result = await securityService.createUser(request.body);
        response.set('Cache-Control', 'no-store').status(201).json(result);
      } catch (error) {
        if (validation(response, error)) return;
        next(error);
      }
    },
  );

  router.patch(
    '/admin/security/users/:userId',
    adminAuth.requireUsers,
    operationAudit('security.user.update'),
    jsonBody,
    async (request, response, next) => {
      const userId = parsePositiveInteger(request.params.userId);
      if (!userId) return response.status(400).json({ error: 'userId must be a positive integer' });
      try {
        const user = await securityService.updateUser(userId, request.body);
        if (!user) return response.status(404).json({ error: 'Administrator user not found' });
        response.set('Cache-Control', 'no-store').json({ user });
      } catch (error) {
        if (validation(response, error)) return;
        next(error);
      }
    },
  );

  router.delete(
    '/admin/security/users/:userId',
    adminAuth.requireUsers,
    operationAudit('security.user.delete'),
    async (request, response, next) => {
      const userId = parsePositiveInteger(request.params.userId);
      if (!userId) return response.status(400).json({ error: 'userId must be a positive integer' });
      try {
        const user = await securityService.deleteUser(userId, request.adminUser.id);
        if (!user) return response.status(404).json({ error: 'Administrator user not found' });
        response.json({ user });
      } catch (error) {
        if (validation(response, error)) return;
        next(error);
      }
    },
  );

  router.post(
    '/admin/security/users/:userId/temporary-password',
    adminAuth.requireUsers,
    operationAudit('security.user.temporary-password'),
    async (request, response, next) => {
      const userId = parsePositiveInteger(request.params.userId);
      if (!userId) return response.status(400).json({ error: 'userId must be a positive integer' });
      try {
        const result = await securityService.resetTemporaryPassword(userId);
        if (!result) return response.status(404).json({ error: 'Administrator user not found' });
        response.set('Cache-Control', 'no-store').json(result);
      } catch (error) {
        if (validation(response, error)) return;
        next(error);
      }
    },
  );

  router.post(
    '/admin/security/users/:userId/block',
    adminAuth.requireUsers,
    operationAudit('security.user.block'),
    jsonBody,
    async (request, response, next) => {
      const userId = parsePositiveInteger(request.params.userId);
      if (!userId) return response.status(400).json({ error: 'userId must be a positive integer' });
      try {
        const user = await securityService.blockUser(userId, request.body, request.adminUser);
        if (!user) return response.status(404).json({ error: 'Administrator user not found' });
        response.json({ user });
      } catch (error) {
        if (validation(response, error)) return;
        next(error);
      }
    },
  );

  router.post(
    '/admin/security/users/:userId/unblock',
    adminAuth.requireUsers,
    operationAudit('security.user.unblock'),
    async (request, response, next) => {
      const userId = parsePositiveInteger(request.params.userId);
      if (!userId) return response.status(400).json({ error: 'userId must be a positive integer' });
      try {
        const user = await securityService.unblockUser(userId);
        if (!user) return response.status(404).json({ error: 'Administrator user not found' });
        response.json({ user });
      } catch (error) { next(error); }
    },
  );

  router.get('/admin/security/settings', adminAuth.requireSecurity, async (_request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store').json({ settings: await securityService.getSecuritySettings() });
    } catch (error) { next(error); }
  });

  router.put(
    '/admin/security/settings',
    adminAuth.requireSecurity,
    operationAudit('security.settings.update'),
    jsonBody,
    async (request, response, next) => {
      try {
        response.json({ settings: await securityService.saveSecuritySettings(request.body) });
      } catch (error) {
        if (validation(response, error)) return;
        next(error);
      }
    },
  );

  router.get('/admin/security/ip-blocks', adminAuth.requireSecurity, async (_request, response, next) => {
    try { response.json({ blocks: await securityService.listIpBlocks() }); }
    catch (error) { next(error); }
  });

  router.post(
    '/admin/security/ip-blocks',
    adminAuth.requireSecurity,
    operationAudit('security.ip.block'),
    jsonBody,
    async (request, response, next) => {
      try {
        const block = await securityService.createIpBlock(
          request.body,
          request.adminUser,
          adminClientIp(request),
        );
        response.status(201).json({ block });
      } catch (error) {
        if (validation(response, error)) return;
        next(error);
      }
    },
  );

  router.delete(
    '/admin/security/ip-blocks/:blockId',
    adminAuth.requireSecurity,
    operationAudit('security.ip.unblock'),
    async (request, response, next) => {
      const blockId = parsePositiveInteger(request.params.blockId);
      if (!blockId) return response.status(400).json({ error: 'blockId must be a positive integer' });
      try {
        if (!await securityService.deleteIpBlock(blockId)) return response.status(404).json({ error: 'IP block not found' });
        response.json({ deleted: true });
      } catch (error) { next(error); }
    },
  );

  router.get('/admin/security/audit/facets', adminAuth.requireAudit, async (_request, response, next) => {
    try { response.json(await securityService.auditFacets()); }
    catch (error) { next(error); }
  });

  router.get('/admin/security/audit', adminAuth.requireAudit, async (request, response, next) => {
    try {
      const filters = parseAuditFilters(request.query);
      response.set('Cache-Control', 'no-store').json({
        entries: await securityService.listAudit(filters),
        limit: filters.limit,
        offset: filters.offset,
      });
    } catch (error) {
      if (validation(response, error)) return;
      next(error);
    }
  });

  router.get('/admin/security/audit/export.csv', adminAuth.requireAudit, async (request, response, next) => {
    try {
      const filters = parseAuditFilters(request.query, { limitDefault: 5000, limitMax: 5000 });
      const entries = await securityService.listAudit(filters);
      const lines = [['createdAt','username','ipAddress','eventType','operationType','status','durationMs','details']];
      for (const entry of entries) {
        lines.push([
          entry.createdAt, entry.username, entry.ipAddress, entry.eventType,
          entry.operationType, entry.status, entry.durationMs,
          JSON.stringify(entry.details ?? {}),
        ]);
      }
      response
        .set('Cache-Control', 'no-store')
        .set('Content-Disposition', 'attachment; filename="admin-audit.csv"')
        .type('text/csv')
        .send(`${lines.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`);
    } catch (error) {
      if (validation(response, error)) return;
      next(error);
    }
  });

  return router;
}
