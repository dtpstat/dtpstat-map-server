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
  createDiscussionInboxRouter,
} from '../../routes/discussion-inbox-api.js';
import {
  createGeometryEditorRouter,
} from '../../routes/geometry-editor-api.js';
import {
  createLineTypesRouter,
} from '../../routes/line-types-api.js';
import {
  createPointTypesRouter,
} from '../../routes/point-types-api.js';
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
import {
  adminJsonBody,
} from '../../http/admin-json-body.js';

export function installApplicationApiRoutes(
  app,
  {
    repository,
    lineTypesRepository,
    pointTypesRepository,
    pointTypeIconStore,
    projectSettingsRepository,
    settingsTransferService,
    reportConfigService,
    discussionInboxService,
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
    notificationEvents,
    config,
  },
) {
  const commonAdmin = {
    adminAuth,
    securityService,
    notificationEvents,
    maxBodyBytes:
      config.importApi
        .maxBodyBytes,
    sessionCookieSecureOnly:
      config.environment ===
      'production',
  };

  app.use(
    '/api',
    createAdminSecurityRouter(
      commonAdmin,
    ),
  );

  if (discussionInboxService) {
    app.use(
      '/api',
      createDiscussionInboxRouter({
        discussionInboxService,
        adminAuth,
      }),
    );
  }

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
    createPointTypesRouter({
      pointTypesRepository,
      pointTypeIconStore,
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
      jsonBody:
        adminJsonBody,
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
