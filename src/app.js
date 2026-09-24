import express from 'express';
import {
  installApplicationApiRoutes,
} from './application/http/api-composition.js';
import {
  installAppHttpMiddleware,
} from './http/app-middleware.js';
import {
  installAppTerminalHandlers,
} from './http/app-terminal-handlers.js';
import {
  installPublicSiteRoutes,
} from './http/public-site.js';
import {
  createAdminTaskManager,
} from './shared/tasks/admin-task-manager.js';
import {
  createTestAppDefaults,
} from './testing/app-defaults.js';

/**
 * @param {{
 *   repository: import('./routes/api.js').CitiesRepository,
 *   lineTypesRepository?: { list: () => Promise<any[]>, save: (payload: unknown) => Promise<any[]> },
 *   projectSettingsRepository?: { get: () => Promise<any>, save: (payload: unknown) => Promise<any> },
 *   settingsTransferService?: { exportSettings: () => Promise<object>, importSettings: (payload: unknown) => Promise<object> },
 *   reportConfigService?: { get: () => Promise<any>, save: (payload: unknown) => Promise<any> },
 *   refreshPublicDownloads?: () => Promise<any>,
 *   refreshPublicDownloadsAfterSettingsImport?: () => Promise<any>,
 *   refreshProjectDerived?: () => Promise<any>,
 *   refreshOsmBoundaryDerived?: () => Promise<any>,
 *   osmImportSettingsRepository?: { get: Function, save: Function },
 *   osmBoundaryAdminRepository?: { list: Function, getGeometry: Function, update: Function },
 *   exportRepository: import('./routes/api.js').DataExportRepository,
 *   importService: import('./routes/api.js').DataImportService,
 *   cityBoundaryTransferService: import('./routes/api.js').CityBoundaryTransferService,
 *   populationService: import('./routes/api.js').PopulationImportService,
 *   kmlUpdateService: import('./routes/api.js').KmlUpdateService,
 *   osmCityUpdateService: import('./routes/api.js').OsmCityUpdateService,
 *   adminTasks?: ReturnType<typeof createAdminTaskManager>,
 *   adminAuth?: ReturnType<import('./http/admin-auth.js').createAdminAuthorization>,
 *   securityService?: ReturnType<import('./modules/security/service.js').createAdminSecurityService>,
 *   config: any
 * }} dependencies
 */
export function createApp({
  repository,
  lineTypesRepository,
  projectSettingsRepository,
  settingsTransferService,
  reportConfigService,
  refreshPublicDownloads,
  refreshPublicDownloadsAfterSettingsImport,
  refreshProjectDerived,
  refreshOsmBoundaryDerived,
  osmImportSettingsRepository,
  osmBoundaryAdminRepository,
  exportRepository,
  importService,
  cityBoundaryTransferService,
  populationService,
  kmlUpdateService,
  osmCityUpdateService,
  adminTasks = createAdminTaskManager(),
  adminAuth,
  securityService,
  config,
}) {
  const app = express();

  const testDefaults =
    config.environment === 'test'
      ? createTestAppDefaults(
        config,
      )
      : null;

  const effectiveLineTypesRepository =
    lineTypesRepository ??
    testDefaults
      ?.lineTypesRepository ??
    null;

  const effectiveProjectSettingsRepository =
    projectSettingsRepository ??
    testDefaults
      ?.projectSettingsRepository ??
    null;

  const effectiveSettingsTransferService =
    settingsTransferService ??
    testDefaults
      ?.settingsTransferService ??
    null;

  const effectiveReportConfigService =
    reportConfigService ??
    testDefaults
      ?.reportConfigService ??
    null;

  const effectiveAdminAuth =
    adminAuth ??
    testDefaults?.adminAuth;

  const effectiveSecurityService =
    securityService ??
    testDefaults
      ?.securityService;

  if (
    !effectiveLineTypesRepository
  ) {
    throw new Error(
      'lineTypesRepository is required',
    );
  }

  if (
    !effectiveProjectSettingsRepository
  ) {
    throw new Error(
      'projectSettingsRepository is required',
    );
  }

  if (
    !effectiveSettingsTransferService
  ) {
    throw new Error(
      'settingsTransferService is required',
    );
  }

  if (
    !effectiveReportConfigService
  ) {
    throw new Error(
      'reportConfigService is required',
    );
  }

  if (
    !effectiveAdminAuth ||
    !effectiveSecurityService
  ) {
    throw new Error(
      'adminAuth and securityService are required',
    );
  }

  installAppHttpMiddleware(
    app,
    {
      config,
      adminAuth:
        effectiveAdminAuth,
    },
  );

  installApplicationApiRoutes(
    app,
    {
      repository,
      lineTypesRepository:
        effectiveLineTypesRepository,
      projectSettingsRepository:
        effectiveProjectSettingsRepository,
      settingsTransferService:
        effectiveSettingsTransferService,
      reportConfigService:
        effectiveReportConfigService,
      refreshPublicDownloads,
      refreshPublicDownloadsAfterSettingsImport,
      refreshProjectDerived,
      refreshOsmBoundaryDerived,
      osmImportSettingsRepository,
      osmBoundaryAdminRepository,
      exportRepository,
      importService,
      cityBoundaryTransferService,
      populationService,
      kmlUpdateService,
      osmCityUpdateService,
      adminTasks,
      adminAuth:
        effectiveAdminAuth,
      securityService:
        effectiveSecurityService,
      config,
    },
  );

  installPublicSiteRoutes(
    app,
    {
      config,
      projectSettingsRepository:
        effectiveProjectSettingsRepository,
    },
  );

  installAppTerminalHandlers(
    app,
  );

  return app;
}
