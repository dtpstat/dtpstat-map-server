import {
  createAdminSecurityRouter,
} from '../../routes/admin-security-api.js';
import {
  createApiRouter,
} from '../../routes/api.js';
import {
  createKmlTransferRouter,
} from '../../routes/kml-transfer-api.js';
import {
  createGeometryEditorRouter,
} from '../../routes/geometry-editor-api.js';
import {
  createLineTypesRouter,
} from '../../routes/line-types-api.js';
import {
  createOsmBoundariesRouter,
} from '../../routes/osm-boundaries-api.js';
import {
  createProjectSettingsRouter,
} from '../../routes/project-settings-api.js';
import {
  createProjectSettingsTransferRouter,
} from '../../routes/project-settings-transfer-api.js';
import {
  createReportConfigRouter,
} from '../../routes/report-config-api.js';

export function installApplicationApiRoutes(
  app,
  {
    repository,
    lineTypesRepository,
    projectSettingsRepository,
    settingsTransferService,
    reportConfigService,
    geometryEditorService,
    geometryImportService,
    refreshPublicDownloads,
    refreshPublicDownloadsAfterSettingsImport,
    refreshProjectDerived,
    refreshOsmBoundaryDerived,
    refreshGeometryDerived,
    osmImportSettingsRepository,
    osmBoundaryAdminRepository,
    exportRepository,
    importService,
    cityBoundaryTransferService,
    populationService,
    kmlUpdateService,
    osmCityUpdateService,
    adminTasks,
    adminAuth,
    securityService,
    realtimeEvents,
    config,
  },
) {
  const commonAdmin = {
    adminAuth,
    securityService,
    maxBodyBytes:
      config.importApi
        .maxBodyBytes,
  };

  app.use(
    '/api',
    createAdminSecurityRouter(
      commonAdmin,
    ),
  );

  app.use(
    '/api',
    createProjectSettingsTransferRouter({
      settingsTransferService,
      ...commonAdmin,
      afterImport: async () =>
        refreshPublicDownloadsAfterSettingsImport
          ?.(),
    }),
  );

  app.use(
    '/api',
    createLineTypesRouter({
      lineTypesRepository,
      ...commonAdmin,
    }),
  );

  app.use(
    '/api',
    createProjectSettingsRouter({
      projectSettingsRepository,
      ...commonAdmin,
      afterPublicDownloadNameSave:
        async () =>
          refreshPublicDownloads
            ?.(),
      afterSettingsSave:
        async () =>
          refreshProjectDerived
            ?.(),
    }),
  );

  if (
    osmImportSettingsRepository &&
    osmBoundaryAdminRepository
  ) {
    app.use(
      '/api',
      createOsmBoundariesRouter({
        settingsRepository:
          osmImportSettingsRepository,
        boundaryRepository:
          osmBoundaryAdminRepository,
        adminAuth,
        securityService,
        osmConfig:
          config.osmCityUpdate,
        afterBoundaryChange:
          async () =>
            refreshOsmBoundaryDerived
              ?.(),
        realtimeEvents,
      }),
    );
  }

  if (geometryEditorService) {
    app.use(
      '/api',
      createGeometryEditorRouter({
        geometryEditorService,
        ...commonAdmin,
        afterRecalculate:
          async () =>
            refreshGeometryDerived
              ?.(),
        realtimeEvents,
      }),
    );
  }

  app.use(
    '/api',
    createReportConfigRouter({
      reportConfigService,
      lineTypesRepository,
      ...commonAdmin,
      afterSave: async () =>
        refreshPublicDownloads
          ?.(),
    }),
  );

  app.use(
    '/api',
    createKmlTransferRouter({
      exportRepository,
      importService,
      adminTasks,
      ...commonAdmin,
    }),
  );

  app.use(
    '/api',
    createApiRouter({
      repository,
      exportRepository,
      importService,
      cityBoundaryTransferService,
      populationService,
      kmlUpdateService,
      geometryImportService,
      osmCityUpdateService,
      adminTasks,
      adminAuth,
      securityService,
      publicMap:
        config.publicMap,
      importApi:
        config.importApi,
      kmlUpdate:
        config.kmlUpdate,
      osmCityUpdate:
        config.osmCityUpdate,
    }),
  );
}
