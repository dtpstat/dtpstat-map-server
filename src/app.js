import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createAdminTaskManager } from './shared/tasks/admin-task-manager.js';
import {
  publicDownloadFiles,
} from './data/public-download-name.js';
import {
  installAppHttpMiddleware,
} from './http/app-middleware.js';
import { projectManifest, renderProjectPage } from './http/project-page.js';
import { createAdminSecurityRouter } from './routes/admin-security-api.js';
import { createApiRouter } from './routes/api.js';
import { createKmlTransferRouter } from './routes/kml-transfer-api.js';
import { createLineTypesRouter } from './routes/line-types-api.js';
import { createOsmBoundariesRouter } from './routes/osm-boundaries-api.js';
import { createProjectSettingsRouter } from './routes/project-settings-api.js';
import { createProjectSettingsTransferRouter } from './routes/project-settings-transfer-api.js';
import { createReportConfigRouter } from './routes/report-config-api.js';
import {
  createTestAppDefaults,
} from './testing/app-defaults.js';

const PUBLIC_ASSETS = new Map([
  ['/favicon.ico', 'favicon.ico'],
  ['/favicon-16x16.png', 'favicon-16x16.png'],
  ['/favicon-32x32.png', 'favicon-32x32.png'],
  ['/apple-touch-icon.png', 'apple-touch-icon.png'],
  ['/android-chrome-192x192.png', 'android-chrome-192x192.png'],
  ['/android-chrome-512x512.png', 'android-chrome-512x512.png'],
]);

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
 *   securityService?: ReturnType<import('./data/admin-security.js').createAdminSecurityService>,
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

  if (!effectiveLineTypesRepository) throw new Error('lineTypesRepository is required');
  if (!effectiveProjectSettingsRepository) throw new Error('projectSettingsRepository is required');
  if (!effectiveSettingsTransferService) throw new Error('settingsTransferService is required');
  if (!effectiveReportConfigService) throw new Error('reportConfigService is required');
  if (!effectiveAdminAuth || !effectiveSecurityService) {
    throw new Error('adminAuth and securityService are required');
  }

  const publicDownloadDirectory =
    path.join(
      config.projectRoot,
      'var',
      'public-downloads',
    );

  const publicPageTemplate =
    readFileSync(
      path.join(
        config.projectRoot,
        'index.html',
      ),
      'utf8',
    );

  installAppHttpMiddleware(
    app,
    {
      config,
      adminAuth:
        effectiveAdminAuth,
    },
  );

  const commonAdmin = {
    adminAuth: effectiveAdminAuth,
    securityService: effectiveSecurityService,
    maxBodyBytes: config.importApi.maxBodyBytes,
  };
  app.use('/api', createAdminSecurityRouter(commonAdmin));
  app.use('/api', createProjectSettingsTransferRouter({
    settingsTransferService: effectiveSettingsTransferService,
    ...commonAdmin,
    afterImport: async () => refreshPublicDownloadsAfterSettingsImport?.(),
  }));
  app.use('/api', createLineTypesRouter({
    lineTypesRepository: effectiveLineTypesRepository,
    ...commonAdmin,
  }));
  app.use('/api', createProjectSettingsRouter({
    projectSettingsRepository: effectiveProjectSettingsRepository,
    ...commonAdmin,
    afterPublicDownloadNameSave: async () => refreshPublicDownloads?.(),
    afterSettingsSave: async () => refreshProjectDerived?.(),
  }));
  if (osmImportSettingsRepository && osmBoundaryAdminRepository) {
    app.use('/api', createOsmBoundariesRouter({
      settingsRepository: osmImportSettingsRepository,
      boundaryRepository: osmBoundaryAdminRepository,
      adminAuth: effectiveAdminAuth,
      securityService: effectiveSecurityService,
      osmConfig: config.osmCityUpdate,
      afterBoundaryChange: async () => refreshOsmBoundaryDerived?.(),
    }));
  }
  app.use('/api', createReportConfigRouter({
    reportConfigService: effectiveReportConfigService,
    lineTypesRepository: effectiveLineTypesRepository,
    ...commonAdmin,
    afterSave: async () => refreshPublicDownloads?.(),
  }));
  app.use('/api', createKmlTransferRouter({
    exportRepository,
    importService,
    adminTasks,
    ...commonAdmin,
  }));
  app.use('/api', createApiRouter({
    repository,
    exportRepository,
    importService,
    cityBoundaryTransferService,
    populationService,
    kmlUpdateService,
    osmCityUpdateService,
    adminTasks,
    adminAuth: effectiveAdminAuth,
    securityService: effectiveSecurityService,
    publicMap: config.publicMap,
    importApi: config.importApi,
    kmlUpdate: config.kmlUpdate,
    osmCityUpdate: config.osmCityUpdate,
  }));

  for (const [route, fileName] of PUBLIC_ASSETS) {
    app.get(route, (_request, response) => {
      response.sendFile(fileName, { root: config.projectRoot });
    });
  }

  app.get('/:publicDownloadFile', async (request, response, next) => {
    const requestedFile = request.params.publicDownloadFile;
    if (!/\.(?:csv|geojson)$/i.test(requestedFile)) {
      next();
      return;
    }

    try {
      const settings = await effectiveProjectSettingsRepository.get();
      const files = publicDownloadFiles(settings.publicDownloadName);
      const contentTypes = new Map([
        [files.csvFileName, 'text/csv; charset=utf-8'],
        [files.geoJsonFileName, 'application/geo+json; charset=utf-8'],
      ]);
      const contentType = contentTypes.get(requestedFile);
      if (!contentType) {
        next();
        return;
      }

      response
        .set('Cache-Control', 'no-cache')
        .type(contentType)
        .attachment(requestedFile);
      response.sendFile(requestedFile, { root: publicDownloadDirectory }, (error) => {
        if (!error) return;
        if (error.status === 404 || error.code === 'ENOENT') {
          response.status(404).type('text').send('Not found');
          return;
        }
        next(error);
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/site.webmanifest', async (_request, response, next) => {
    try {
      const settings = await effectiveProjectSettingsRepository.get();
      response
        .set('Cache-Control', 'no-cache')
        .type('application/manifest+json')
        .send(JSON.stringify(projectManifest(settings)));
    } catch (error) {
      next(error);
    }
  });

  app.get('/', async (_request, response, next) => {
    try {
      const settings = await effectiveProjectSettingsRepository.get();
      response
        .set('Cache-Control', 'no-cache')
        .type('html')
        .send(renderProjectPage(publicPageTemplate, settings));
    } catch (error) {
      next(error);
    }
  });

  app.use((request, response) => {
    if (request.path.startsWith('/api/')) {
      response.status(404).json({ error: 'API endpoint not found' });
      return;
    }
    response.status(404).type('text').send('Not found');
  });

  app.use((error, request, response, _next) => {
    if (error?.type === 'entity.too.large') {
      response.status(413).json({ error: 'Request body is too large' });
      return;
    }
    if (error?.type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Request body is not valid JSON' });
      return;
    }
    if (error?.status === 415 || error?.type === 'encoding.unsupported') {
      response.status(415).json({ error: error.message || 'Unsupported content encoding' });
      return;
    }

    console.error('Request failed', {
      method: request.method,
      path: request.path,
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(503).json({ error: 'Service temporarily unavailable' });
  });

  return app;
}
