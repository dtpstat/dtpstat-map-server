import express, { Router } from 'express';
import { LineTypeValidationError } from '../data/line-types.js';
import {
  createAdminOperationAudit,
  recordAdminOperationChanges,
} from '../http/admin-auth.js';

/**
 * @param {{
 *   lineTypesRepository: { list: () => Promise<any[]>, save: (payload: unknown) => Promise<any[]> },
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   securityService: ReturnType<import('../data/admin-security.js').createAdminSecurityService>,
 *   maxBodyBytes: number
 * }} dependencies
 */
export function createLineTypesRouter({
  lineTypesRepository,
  adminAuth,
  securityService,
  maxBodyBytes,
}) {
  const router = Router();

  router.get('/line-types', async (_request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      response.json({ lineTypes: await lineTypesRepository.list() });
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/admin/line-types',
    adminAuth.requireInterface,
    createAdminOperationAudit(securityService, 'interface.line-types.update'),
    express.json({
      limit: Math.min(maxBodyBytes, 256 * 1024),
      strict: true,
      inflate: true,
      type: 'application/json',
    }),
    async (request, response, next) => {
      if (request.body === undefined) {
        response.status(415).json({ error: 'Content-Type must be application/json' });
        return;
      }
      try {
        const previousLineTypes = await lineTypesRepository.list();
        const lineTypes = await lineTypesRepository.save(request.body);
        recordAdminOperationChanges(
          response,
          { lineTypes: previousLineTypes },
          { lineTypes },
        );
        response.set('Cache-Control', 'no-store');
        response.json({ lineTypes });
      } catch (error) {
        if (error instanceof LineTypeValidationError) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
