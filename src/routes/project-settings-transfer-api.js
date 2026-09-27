import {
  Router,
} from 'express';
import {
  registerProjectSettingsTransferExportRoutes,
} from './project/transfer-export-routes.js';
import {
  registerProjectSettingsTransferImportRoutes,
} from './project/transfer-import-routes.js';

/**
 * @param {{
 *   settingsTransferService: {
 *     exportSettings: () => Promise<object>,
 *     importSettings: (payload: unknown) => Promise<object>
 *   },
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   securityService: ReturnType<import('../modules/security/service.js').createAdminSecurityService>,
 *   maxBodyBytes: number,
 *   afterImport?: (result: object) => Promise<object | void>
 * }} dependencies
 */
export function createProjectSettingsTransferRouter({
  settingsTransferService,
  adminAuth,
  securityService,
  maxBodyBytes,
  afterImport,
}) {
  const router = Router();

  registerProjectSettingsTransferExportRoutes(
    router,
    {
      settingsTransferService,
      adminAuth,
      securityService,
    },
  );

  registerProjectSettingsTransferImportRoutes(
    router,
    {
      settingsTransferService,
      adminAuth,
      securityService,
      maxBodyBytes,
      afterImport,
    },
  );

  return router;
}
