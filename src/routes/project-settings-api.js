import express, { Router } from 'express';
import { MapboxAccessTokenValidationError } from '../data/mapbox-access-token.js';
import {
  PROJECT_CONTENT_CLASSES,
  PROJECT_CONTENT_TAGS,
  ProjectSettingsValidationError,
} from '../data/project-settings.js';
import { createAdminOperationAudit } from '../http/admin-auth.js';

/**
 * @param {{
 *   projectSettingsRepository: {
 *     get: () => Promise<any>,
 *     save: (payload: unknown) => Promise<any>,
 *     getPublicMapConfig: () => Promise<any>
 *   },
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   securityService: ReturnType<import('../data/admin-security.js').createAdminSecurityService>,
 *   maxBodyBytes: number
 * }} dependencies
 */
export function createProjectSettingsRouter({
  projectSettingsRepository,
  adminAuth,
  securityService,
  maxBodyBytes,
}) {
  const router = Router();
  const jsonBody = express.json({
    limit: Math.min(maxBodyBytes, 256 * 1024),
    strict: true,
    inflate: true,
    type: 'application/json',
  });

  // Registered before the general API router, so /api/config is now backed by
  // PROJECT_SETTINGS. The Mapbox public token necessarily reaches the browser
  // map here, but it is never returned by the admin settings endpoint.
  router.get('/config', async (_request, response, next) => {
    try {
      const map = await projectSettingsRepository.getPublicMapConfig();
      response.set('Cache-Control', 'no-cache');
      response.json({ map });
    } catch (error) {
      next(error);
    }
  });

  router.get('/project', async (_request, response, next) => {
    try {
      const settings = await projectSettingsRepository.get();
      response.set('Cache-Control', 'no-cache');
      response.json(settings);
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/admin/project-settings',
    adminAuth.requireInterface,
    async (_request, response, next) => {
      try {
        const settings = await projectSettingsRepository.get();
        response.set('Cache-Control', 'no-store');
        response.json({
          settings,
          editor: {
            tags: PROJECT_CONTENT_TAGS,
            classes: PROJECT_CONTENT_CLASSES,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/admin/project-settings',
    adminAuth.requireInterface,
    createAdminOperationAudit(securityService, 'interface.project.update'),
    jsonBody,
    async (request, response, next) => {
      try {
        const settings = await projectSettingsRepository.save(request.body);
        response.set('Cache-Control', 'no-store');
        response.json({ settings });
      } catch (error) {
        if (
          error instanceof ProjectSettingsValidationError ||
          error instanceof MapboxAccessTokenValidationError
        ) {
          response.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
