import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CITY_MARKER_ICON } from '../public/js/city-marker-icon.js';
import { createAdminTaskManager } from './data/admin-task-manager.js';
import {
  DEFAULT_PUBLIC_DOWNLOAD_NAME,
  publicDownloadFiles,
} from './data/public-download-name.js';
import {
  DEFAULT_REPORT_CONFIG,
  validateReportConfig,
} from './data/report-config.js';
import { createBasicAuth } from './http/basic-auth.js';
import { projectManifest, renderProjectPage } from './http/project-page.js';
import { createAdminSecurityRouter } from './routes/admin-security-api.js';
import { createApiRouter } from './routes/api.js';
import { createKmlTransferRouter } from './routes/kml-transfer-api.js';
import { createLineTypesRouter } from './routes/line-types-api.js';
import { createProjectSettingsRouter } from './routes/project-settings-api.js';
import { createProjectSettingsTransferRouter } from './routes/project-settings-transfer-api.js';
import { createReportConfigRouter } from './routes/report-config-api.js';

const PUBLIC_ASSETS = new Map([
  ['/favicon.ico', 'favicon.ico'],
  ['/favicon-16x16.png', 'favicon-16x16.png'],
  ['/favicon-32x32.png', 'favicon-32x32.png'],
  ['/apple-touch-icon.png', 'apple-touch-icon.png'],
  ['/android-chrome-192x192.png', 'android-chrome-192x192.png'],
  ['/android-chrome-512x512.png', 'android-chrome-512x512.png'],
]);
const CITY_MARKER_PNG = Buffer.from(CITY_MARKER_ICON.split(',')[1], 'base64');
const TEST_PROJECT_SETTINGS = Object.freeze({
  projectName: 'Выделенные полосы в России',
  keywords: ['выделенные полосы', 'общественный транспорт'],
  footerHtml: '<h2>О проекте</h2><p>Тестовые настройки проекта.</p>',
  yandexMetrikaId: null,
  googleAnalyticsId: null,
  themePreset: 'classic',
  showLineLabels: false,
  showLinePopups: true,
  publicDownloadName: DEFAULT_PUBLIC_DOWNLOAD_NAME,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

function testProjectSettingsRepository() {
  let settings = { ...TEST_PROJECT_SETTINGS };
  return {
    async get() { return settings; },
    async save(payload) {
      settings = { ...payload, updatedAt: new Date().toISOString() };
      return settings;
    },
    async savePublicDownloadName(value) {
      settings = {
        ...settings,
        publicDownloadName: value,
        updatedAt: new Date().toISOString(),
      };
      return {
        publicDownloadName: settings.publicDownloadName,
        updatedAt: settings.updatedAt,
      };
    },
  };
}

function testLineTypesRepository() {
  return {
    async list() { return []; },
    async save() { return []; },
  };
}

function testReportConfigService() {
  let config = structuredClone(DEFAULT_REPORT_CONFIG);
  return {
    async get() { return structuredClone(config); },
    async save(payload) {
      config = {
        ...validateReportConfig(payload),
        updatedAt: new Date().toISOString(),
      };
      return {
        config: structuredClone(config),
        materialized: {
          cities: 0,
          metrics: config.metrics.length,
          rankMetricKey: config.rank.metricKey,
          rankDirection: config.rank.direction,
        },
      };
    },
  };
}

function testSecuritySettings() {
  return {
    maxFailedAttempts: 5,
    failureWindowSeconds: 900,
    lockoutSeconds: 900,
    ipMaxFailedAttempts: 20,
    ipFailureWindowSeconds: 900,
    ipLockoutSeconds: 3600,
    sessionIdleSeconds: 1800,
    sessionAbsoluteSeconds: 43200,
    auditRetentionDays: 365,
  };
}

function testSettingsTransferService() {
  return {
    async exportSettings() {
      return {
        _dtpstat: {
          kind: 'project-settings',
          schemaVersion: 6,
          exportedAt: '2026-01-01T00:00:00.000Z',
        },
        projectSettings: TEST_PROJECT_SETTINGS,
        lineTypes: [],
        reportConfig: structuredClone(DEFAULT_REPORT_CONFIG),
        securitySettings: testSecuritySettings(),
      };
    },
    async importSettings() {
      return {
        projectName: TEST_PROJECT_SETTINGS.projectName,
        lineTypes: 0,
        metrics: DEFAULT_REPORT_CONFIG.metrics.length,
        materializedCities: 0,
      };
    },
  };
}

function testSecurity(config) {
  const username = config.importApi.username ?? config.importApi.bootstrapUsername ?? 'importer';
  const password = config.importApi.password ?? config.importApi.bootstrapPassword ?? 'test-secret';
  const basic = createBasicAuth({ username, password, realm: 'dtpstat-admin' });
  const testUser = {
    id: 1,
    username,
    displayName: username,
    email: null,
    canManageData: true,
    canManageInterface: true,
    canManageUsers: true,
    canViewAudit: true,
    canManageSecurity: true,
    isSuperuser: true,
    isBootstrap: true,
    isBlocked: false,
    mustChangePassword: false,
    hasAvatar: false,
  };
  const requireAuth = (request, response, next) => basic(request, response, () => {
    request.adminUser = testUser;
    request.adminSessionId = null;
    request.adminAuthMethod = 'basic';
    next();
  });
  const adminAuth = {
    requireAny: requireAuth,
    requireAdminEntry: requireAuth,
    requireProfile: requireAuth,
    requireData: requireAuth,
    requireInterface: requireAuth,
    requireUsers: requireAuth,
    requireAudit: requireAuth,
    requireSecurity: requireAuth,
    requireSuperuser: requireAuth,
  };
  const securityService = {
    async login(payload) {
      if (payload?.username !== username || payload?.password !== password) {
        return { status: 'invalid' };
      }
      return {
        status: 'success',
        user: testUser,
        token: 'test-session-token',
        sessionId: 1,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    },
    async logout() {},
    async appendAudit() {},
    async listUsers() { return [testUser]; },
    async createUser() { return { user: testUser, temporaryPassword: 'Temp-Password-1234' }; },
    async updateUser() { return testUser; },
    async deleteUser() { return testUser; },
    async resetTemporaryPassword() { return { user: testUser, temporaryPassword: 'Temp-Password-1234' }; },
    async blockUser() { return testUser; },
    async unblockUser() { return testUser; },
    async updateOwnProfile() { return testUser; },
    async changeOwnPassword() { return testUser; },
    async getAvatar() { return null; },
    async saveAvatar() { return testUser; },
    async clearAvatar() { return testUser; },
    async listUserSessions() { return []; },
    async revokeSession() { return true; },
    async revokeOtherSessions() { return 0; },
    async getSecuritySettings() { return testSecuritySettings(); },
    async saveSecuritySettings(payload) { return payload; },
    async listIpBlocks() { return []; },
    async createIpBlock(payload) { return { id: 1, ...payload }; },
    async deleteIpBlock() { return true; },
    async listAudit() { return []; },
    async auditFacets() { return { eventTypes: [], operationTypes: [], statuses: [] }; },
  };
  return { adminAuth, securityService };
}

/**
 * @param {{
 *   repository: import('./routes/api.js').CitiesRepository,
 *   lineTypesRepository?: { list: () => Promise<any[]>, save: (payload: unknown) => Promise<any[]> },
 *   projectSettingsRepository?: { get: () => Promise<any>, save: (payload: unknown) => Promise<any> },
 *   settingsTransferService?: { exportSettings: () => Promise<object>, importSettings: (payload: unknown) => Promise<object> },
 *   reportConfigService?: { get: () => Promise<any>, save: (payload: unknown) => Promise<any> },
 *   refreshPublicDownloads?: () => Promise<any>,
 *   refreshPublicDownloadsAfterSettingsImport?: () => Promise<any>,
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
  const isProduction = config.environment === 'production';
  const effectiveLineTypesRepository = lineTypesRepository ??
    (config.environment === 'test' ? testLineTypesRepository() : null);
  const effectiveProjectSettingsRepository = projectSettingsRepository ??
    (config.environment === 'test' ? testProjectSettingsRepository() : null);
  const effectiveSettingsTransferService = settingsTransferService ??
    (config.environment === 'test' ? testSettingsTransferService() : null);
  const effectiveReportConfigService = reportConfigService ??
    (config.environment === 'test' ? testReportConfigService() : null);
  const testAuth = config.environment === 'test' && (!adminAuth || !securityService)
    ? testSecurity(config)
    : null;
  const effectiveAdminAuth = adminAuth ?? testAuth?.adminAuth;
  const effectiveSecurityService = securityService ?? testAuth?.securityService;

  if (!effectiveLineTypesRepository) throw new Error('lineTypesRepository is required');
  if (!effectiveProjectSettingsRepository) throw new Error('projectSettingsRepository is required');
  if (!effectiveSettingsTransferService) throw new Error('settingsTransferService is required');
  if (!effectiveReportConfigService) throw new Error('reportConfigService is required');
  if (!effectiveAdminAuth || !effectiveSecurityService) {
    throw new Error('adminAuth and securityService are required');
  }

  const publicDirectory = path.join(config.projectRoot, 'public');
  const adminDirectory = path.join(config.projectRoot, 'admin');
  const publicDownloadDirectory = path.join(config.projectRoot, 'var', 'public-downloads');
  const publicPageTemplate = readFileSync(path.join(config.projectRoot, 'index.html'), 'utf8');

  app.disable('x-powered-by');
  app.set(
    'trust proxy',
    config.http?.trustProxyHops > 0 ? config.http.trustProxyHops : false,
  );
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'wasm-unsafe-eval'",
            'https://mc.yandex.ru',
            'https://yastatic.net',
            'https://*.googletagmanager.com',
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: [
            "'self'", 'data:', 'blob:', 'https://*.mapbox.com',
            'https://mc.yandex.ru', 'https://*.google-analytics.com',
            'https://*.googletagmanager.com',
          ],
          connectSrc: [
            "'self'", 'ws:', 'wss:', 'https://*.mapbox.com',
            'https://mc.yandex.ru', 'wss://mc.yandex.ru',
            'https://*.google-analytics.com', 'https://*.analytics.google.com',
            'https://*.googletagmanager.com',
          ],
          workerSrc: ["'self'", 'blob:'],
          childSrc: ["'self'", 'blob:', 'https://mc.yandex.ru'],
          frameSrc: ["'self'", 'blob:', 'https://mc.yandex.ru'],
        },
      },
    }),
  );
  app.use(compression());

  app.get('/images/city-marker.png', (_request, response) => {
    response
      .set('Cache-Control', isProduction ? 'public, max-age=86400' : 'no-cache')
      .type('image/png')
      .send(CITY_MARKER_PNG);
  });

  for (const route of ['/admin', '/admin/', '/admin/index.html']) {
    app.get(route, effectiveAdminAuth.requireAdminEntry, (_request, response) => {
      response.set('Cache-Control', 'no-store');
      response.sendFile('index.html', { root: adminDirectory });
    });
  }
  app.use(
    '/admin',
    express.static(adminDirectory, {
      index: false,
      maxAge: isProduction ? '5m' : 0,
    }),
  );

  app.use(
    '/vendor/mapbox-gl',
    express.static(path.join(config.projectRoot, 'node_modules/mapbox-gl/dist'), {
      immutable: isProduction,
      maxAge: isProduction ? '30d' : 0,
    }),
  );
  app.use(
    express.static(publicDirectory, {
      index: false,
      maxAge: isProduction ? '1h' : 0,
    }),
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
  }));
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
