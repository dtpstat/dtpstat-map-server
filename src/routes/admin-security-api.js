import express, { Router } from 'express';
import { AdminSecurityValidationError } from '../data/admin-security.js';
import { createAdminOperationAudit } from '../http/admin-auth.js';

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * @param {{
 *   securityService: ReturnType<import('../data/admin-security.js').createAdminSecurityService>,
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   maxBodyBytes: number
 * }} dependencies
 */
export function createAdminSecurityRouter({
  securityService,
  adminAuth,
  maxBodyBytes,
}) {
  const router = Router();
  const jsonBody = express.json({
    limit: Math.min(maxBodyBytes, 256 * 1024),
    strict: true,
    inflate: true,
    type: 'application/json',
  });
  const operationAudit = (type) => createAdminOperationAudit(securityService, type);

  router.get('/admin/me', adminAuth.requireAny, (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json({ user: request.adminUser });
  });

  router.get(
    '/admin/security/users',
    adminAuth.requireSuperuser,
    async (_request, response, next) => {
      try {
        response.set('Cache-Control', 'no-store');
        response.json({ users: await securityService.listUsers() });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/admin/security/users',
    adminAuth.requireSuperuser,
    operationAudit('security.user.create'),
    jsonBody,
    async (request, response, next) => {
      try {
        const user = await securityService.createUser(request.body);
        response.set('Cache-Control', 'no-store');
        response.status(201).json({ user });
      } catch (error) {
        if (error instanceof AdminSecurityValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.patch(
    '/admin/security/users/:userId',
    adminAuth.requireSuperuser,
    operationAudit('security.user.update'),
    jsonBody,
    async (request, response, next) => {
      const userId = parsePositiveInteger(request.params.userId);
      if (!userId) {
        response.status(400).json({ error: 'userId must be a positive integer' });
        return;
      }
      try {
        const user = await securityService.updateUser(userId, request.body);
        if (!user) {
          response.status(404).json({ error: 'Administrator user not found' });
          return;
        }
        response.set('Cache-Control', 'no-store');
        response.json({ user });
      } catch (error) {
        if (error instanceof AdminSecurityValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.put(
    '/admin/security/users/:userId/password',
    adminAuth.requireSuperuser,
    operationAudit('security.user.password'),
    jsonBody,
    async (request, response, next) => {
      const userId = parsePositiveInteger(request.params.userId);
      if (!userId) {
        response.status(400).json({ error: 'userId must be a positive integer' });
        return;
      }
      try {
        const user = await securityService.changePassword(userId, request.body);
        if (!user) {
          response.status(404).json({ error: 'Administrator user not found' });
          return;
        }
        response.set('Cache-Control', 'no-store');
        response.json({ user });
      } catch (error) {
        if (error instanceof AdminSecurityValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.get(
    '/admin/security/settings',
    adminAuth.requireSuperuser,
    async (_request, response, next) => {
      try {
        response.set('Cache-Control', 'no-store');
        response.json({ settings: await securityService.getSecuritySettings() });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/admin/security/settings',
    adminAuth.requireSuperuser,
    operationAudit('security.settings.update'),
    jsonBody,
    async (request, response, next) => {
      try {
        const settings = await securityService.saveSecuritySettings(request.body);
        response.set('Cache-Control', 'no-store');
        response.json({ settings });
      } catch (error) {
        if (error instanceof AdminSecurityValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  router.get(
    '/admin/security/audit',
    adminAuth.requireSuperuser,
    async (request, response, next) => {
      const limit = request.query.limit === undefined ? 200 : Number(request.query.limit);
      const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
      if (
        !Number.isInteger(limit) || limit < 1 || limit > 500 ||
        !Number.isInteger(offset) || offset < 0 || offset > 1000000
      ) {
        response.status(400).json({
          error: 'limit must be 1..500 and offset must be a non-negative integer',
        });
        return;
      }
      try {
        response.set('Cache-Control', 'no-store');
        response.json({
          entries: await securityService.listAudit({ limit, offset }),
          limit,
          offset,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
