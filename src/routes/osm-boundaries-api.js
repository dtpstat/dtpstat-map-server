import express, {
  Router,
} from 'express';
import {
  registerOsmBoundaryRoutes,
} from './osm/boundary-routes.js';
import {
  registerOsmSettingsRoutes,
} from './osm/settings-routes.js';

/**
 * @param {{
 *   settingsRepository: { get: Function, save: Function },
 *   boundaryRepository: {
 *     list: Function,
 *     getGeometry: Function,
 *     update: Function,
 *     setSubtreeActive: Function
 *   },
 *   adminAuth: any,
 *   securityService: any,
 *   osmConfig: any,
 *   afterBoundaryChange?: () => Promise<any>
 * }} dependencies
 */
export function createOsmBoundariesRouter({
  settingsRepository,
  boundaryRepository,
  adminAuth,
  securityService,
  osmConfig,
  afterBoundaryChange,
}) {
  const router = Router();

  const jsonBody = express.json({
    limit: 256 * 1024,
    strict: true,
    inflate: true,
    type: 'application/json',
  });

  registerOsmSettingsRoutes(
    router,
    {
      settingsRepository,
      adminAuth,
      securityService,
      osmConfig,
      jsonBody,
    },
  );

  registerOsmBoundaryRoutes(
    router,
    {
      boundaryRepository,
      adminAuth,
      securityService,
      jsonBody,
      afterBoundaryChange,
    },
  );

  return router;
}
