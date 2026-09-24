import { Router } from 'express';
import {
  createAdminTaskHttpRuntime,
} from '../application/admin-tasks/http-runtime.js';
import {
  logAdminTaskProgress,
} from '../application/admin-tasks/progress-log.js';
import {
  registerAdminTaskRoutes,
} from '../application/admin-tasks/routes.js';
import {
  createDataTransferRuntime,
} from '../application/data-transfer/runtime.js';
import {
  registerDataExportRoutes,
  registerDataImportRoutes,
  registerPopulationRoutes,
} from '../application/data-transfer/routes.js';
import { registerLineRoutes } from '../modules/lines/routes.js';
import { registerMapRoutes } from '../modules/map/routes.js';
import { registerOsmRoutes } from '../modules/osm/routes.js';
import { jsonBody } from '../shared/http/express.js';
import {
  parseBoolean,
  parseCoordinates,
} from '../shared/http/params.js';

/**
 * @typedef {{
 *   health: () => Promise<void>,
 *   listCities: () => Promise<any[]>,
 *   getCityGeometries: (cityId: number) => Promise<object | null>,
 *   getViewportGeometries: (viewport: object) => Promise<object>
 * }} CitiesRepository
 */

/**
 * @typedef {{
 *   exportCityBoundaries: () => Promise<object>,
 *   exportLines: () => Promise<object>,
 *   exportPopulations: () => Promise<object>
 * }} DataExportRepository
 */

/** @typedef {{ replaceFromGeoJson: (collection: unknown, operation?: object) => Promise<object> }} DataImportService */
/** @typedef {{ replaceFromGeoJson: (collection: unknown, operation?: object) => Promise<object> }} CityBoundaryTransferService */
/** @typedef {{ updateFromJson: (payload: unknown, operation?: object) => Promise<object> }} PopulationImportService */
/** @typedef {{ update: (body: unknown, query: Record<string, unknown>, operation?: object) => Promise<object> }} KmlUpdateService */
/** @typedef {{ update: (body: unknown, query: Record<string, unknown>, operation?: object) => Promise<object> }} OsmCityUpdateService */

/**
 * @param {{
 *   repository: CitiesRepository,
 *   exportRepository: DataExportRepository,
 *   importService: DataImportService,
 *   cityBoundaryTransferService: CityBoundaryTransferService,
 *   populationService: PopulationImportService,
 *   kmlUpdateService: KmlUpdateService,
 *   osmCityUpdateService: OsmCityUpdateService,
 *   adminTasks: ReturnType<import('../shared/tasks/admin-task-manager.js').createAdminTaskManager>,
 *   adminAuth: ReturnType<import('../http/admin-auth.js').createAdminAuthorization>,
 *   securityService: ReturnType<import('../data/admin-security.js').createAdminSecurityService>,
 *   publicMap: object,
 *   importApi: {
 *     maxBodyBytes: number,
 *     maxStreamUploadBytes: number,
 *     maxStreamJsonBytes: number,
 *     maxStreamItemBytes: number,
 *     maxStreamZipCompressionRatio?: number,
 *     maxStreamZipEntries?: number,
 *     maxStreamJsonDepth?: number,
 *     maxStreamJsonItems?: number,
 *     streamUploadDirectory: string
 *   },
 *   kmlUpdate: { maxRequestBodyBytes: number, cityBufferMeters: number, cityBufferMaxMeters: number },
 *   osmCityUpdate: any
 * }} dependencies
 */
export function createApiRouter({
  repository,
  exportRepository,
  importService,
  cityBoundaryTransferService,
  populationService,
  kmlUpdateService,
  osmCityUpdateService,
  adminTasks,
  adminAuth,
  securityService,
  publicMap,
  importApi,
  kmlUpdate,
  osmCityUpdate,
}) {
  const router = Router();

  const {
    adminStatusURL,
    clearCompletedAdminTask,
    operationAudit,
    rejectWhileAdminTaskActive,
    startAdminTask,
  } = createAdminTaskHttpRuntime({
    adminTasks,
    securityService,
  });

  const {
    executePortableUpload,
    portableServiceMethod,
    receivePortableUpload,
    removeStreamUpload,
    streamTransfer,
    streamingExportRoute,
  } = createDataTransferRuntime({
    importApi,
    progressLog: logAdminTaskProgress,
  });

  registerMapRoutes(router, {
    repository,
    publicMap,
    parseCoordinates,
  });

  registerDataExportRoutes(router, {
    exportRepository,
    adminAuth,
    operationAudit,
    streamingExportRoute,
  });

  registerDataImportRoutes(router, {
    importService,
    cityBoundaryTransferService,
    adminAuth,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    receivePortableUpload,
    startAdminTask,
    executePortableUpload,
    portableServiceMethod,
    removeStreamUpload,
    parseBoolean,
  });

  registerLineRoutes(router, {
    adminAuth,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    jsonBody,
    kmlUpdate,
    startAdminTask,
    kmlUpdateService,
    progressLog: logAdminTaskProgress,
  });

  registerOsmRoutes(router, {
    adminAuth,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    operationAudit,
    jsonBody,
    osmCityUpdate,
    osmCityUpdateService,
    startAdminTask,
    parseBoolean,
    progressLog: logAdminTaskProgress,
  });

  registerAdminTaskRoutes(router, {
    adminAuth,
    operationAudit,
    adminTasks,
    adminStatusURL,
    streamTransfer,
    osmCityUpdate,
    kmlUpdate,
  });

  registerPopulationRoutes(router, {
    populationService,
    adminAuth,
    rejectWhileAdminTaskActive,
    clearCompletedAdminTask,
    receivePortableUpload,
    startAdminTask,
    executePortableUpload,
    portableServiceMethod,
    removeStreamUpload,
  });

  return router;
}
