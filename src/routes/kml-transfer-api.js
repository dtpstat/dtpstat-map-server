import {
  Router,
} from 'express';
import {
  createAdminTaskHttpRuntime,
} from '../application/admin-tasks/http-runtime.js';
import {
  registerKmlExportRoutes,
} from './kml/export-routes.js';
import {
  registerKmlImportRoutes,
} from './kml/import-routes.js';

/**
 * Portable KML transfer is deliberately separate from the external Google My
 * Maps updater. It carries a complete business line type/style dictionary and
 * uses KML LineString/MultiGeometry only for geometry.
 *
 * @param {{
 *   exportRepository: { exportLines: () => Promise<object> },
 *   importService: {
 *     replaceFromGeoJson: (
 *       collection: unknown,
 *       operation?: object
 *     ) => Promise<object>
 *   },
 *   adminTasks: ReturnType<import('../shared/tasks/admin-task-manager.js').createAdminTaskManager>,
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   securityService: ReturnType<import('../modules/security/service.js').createAdminSecurityService>,
 *   maxBodyBytes: number
 * }} dependencies
 */
export function createKmlTransferRouter({
  exportRepository,
  importService,
  adminTasks,
  adminAuth,
  securityService,
  maxBodyBytes,
}) {
  const router = Router();

  const taskHttp =
    createAdminTaskHttpRuntime({
      adminTasks,
      securityService,
    });

  registerKmlExportRoutes(
    router,
    {
      exportRepository,
      adminAuth,
      securityService,
    },
  );

  registerKmlImportRoutes(
    router,
    {
      importService,
      adminAuth,
      maxBodyBytes,
      rejectWhileAdminTaskActive:
        taskHttp
          .rejectWhileAdminTaskActive,
      startAdminTask:
        taskHttp.startAdminTask,
    },
  );

  return router;
}
