import express, {
  Router,
} from 'express';
import {
  CITY_MARKER_ICON_MAX_BYTES,
} from '../data/city-marker-icon.js';
import {
  registerProjectCityMarkerRoutes,
} from './project/city-marker-routes.js';
import {
  registerProjectDownloadNameRoutes,
} from './project/download-name-routes.js';
import {
  registerProjectPublicRoutes,
} from './project/public-routes.js';
import {
  registerProjectSettingsAdminRoutes,
} from './project/settings-routes.js';

/**
 * @param {{
 *   projectSettingsRepository: {
 *     get: () => Promise<any>,
 *     save: (payload: unknown) => Promise<any>,
 *     savePublicDownloadName?: (value: unknown) => Promise<any>,
 *     getPublicMapConfig?: () => Promise<any>,
 *     getCityMarkerIcon?: () => Promise<any>,
 *     saveCityMarkerIcon?: (icon: object) => Promise<any>,
 *     clearCityMarkerIcon?: () => Promise<any>
 *   },
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   securityService: ReturnType<import('../data/admin-security.js').createAdminSecurityService>,
 *   maxBodyBytes: number,
 *   afterPublicDownloadNameSave?: () => Promise<any>,
 *   afterSettingsSave?: () => Promise<any>
 * }} dependencies
 */
export function createProjectSettingsRouter({
  projectSettingsRepository,
  adminAuth,
  securityService,
  maxBodyBytes,
  afterPublicDownloadNameSave,
  afterSettingsSave,
}) {
  const router = Router();

  const jsonBody = express.json({
    limit:
      Math.min(
        maxBodyBytes,
        256 * 1024,
      ),
    strict: true,
    inflate: true,
    type: 'application/json',
  });

  const cityMarkerBody = express.raw({
    limit:
      CITY_MARKER_ICON_MAX_BYTES,
    inflate: false,
    type: 'image/png',
  });

  registerProjectPublicRoutes(
    router,
    {
      projectSettingsRepository,
    },
  );

  registerProjectSettingsAdminRoutes(
    router,
    {
      projectSettingsRepository,
      adminAuth,
      securityService,
      jsonBody,
      afterSettingsSave,
    },
  );

  registerProjectDownloadNameRoutes(
    router,
    {
      projectSettingsRepository,
      adminAuth,
      securityService,
      jsonBody,
      afterPublicDownloadNameSave,
    },
  );

  registerProjectCityMarkerRoutes(
    router,
    {
      projectSettingsRepository,
      adminAuth,
      securityService,
      cityMarkerBody,
    },
  );

  return router;
}
