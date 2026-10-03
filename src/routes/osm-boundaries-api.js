import {
  Router,
} from 'express';
import {
  jsonBody as createJsonBody,
} from '../http/admin-json-body.js';
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
 *   afterBoundaryChange?: () => Promise<any>,
 *   realtimeEvents?: { publish: Function }
 * }} dependencies
 */
export function createOsmBoundariesRouter({
  settingsRepository,
  boundaryRepository,
  adminAuth,
  securityService,
  osmConfig,
  afterBoundaryChange,
  realtimeEvents,
  notificationEvents = null,
  discussionInboxService = null,
}) {
  const router = Router();

  const jsonBody =
    createJsonBody(
      256 * 1024,
      'application/json',
    );

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
      realtimeEvents,
      notificationEvents,
      discussionInboxService,
    },
  );

  return router;
}
