import 'dotenv/config';
import path from 'node:path';
import {createApp} from './app.js';
import {loadConfig} from './config.js';
import {createAdminSecurityService} from './data/admin-security.js';
import {createAdminTaskManager} from './data/admin-task-manager.js';
import {createPublicDownloadService} from './data/public-download-service.js';
import {createAdminSecurityRepository} from './db/admin-security-repository.js';
import {createAdminTaskSuccessRepository} from './db/admin-task-success-repository.js';
import {createCitiesRepository} from './db/cities-repository.js';
import {createCityBoundaryTransferService} from './db/city-boundary-transfer-service.js';
import {createDataExportRepository} from './db/data-export-repository.js';
import {createDataImportService} from './db/data-import-service.js';
import {createKmlUpdateService} from './db/kml-update-service.js';
import {createLineTypesRepository} from './db/line-types-repository.js';
import {createOsmCityUpdateService} from './db/osm-city-update-service.js';
import {createPopulationImportService} from './db/population-import-service.js';
import {createProjectSettingsRepository} from './db/project-settings-repository.js';
import {createPublicDownloadRepository} from './db/public-download-repository.js';
import {createReportConfigService} from './db/report-config-service.js';
import {createPool} from './db/pool.js';
import {createAdminAuthorization} from './http/admin-auth.js';
import {createAdminWebSocketGateway} from './http/admin-websocket.js';
import {closeServer, startServers} from './http/start-servers.js';
import {
  runServiceOperation,
  serviceErrorDetails,
  serviceLog,
} from './service-log.js';

const PUBLIC_DOWNLOAD_TASK_TYPES = new Set([
  'geojson-import',
  'city-geojson-import',
  'kml-update',
  'osm-city-update',
  'population-update',
]);

async function main() {
  const config = loadConfig();
  serviceLog('info', 'startup', {
    pid: process.pid,
    node: process.version,
    environment: config.environment,
    instance: config.database.schema,
    database: {
      host: config.database.host,
      port: config.database.port,
      name: config.database.database,
      schema: config.database.schema,
      ssl: config.database.ssl !== false,
    },
    listeners: {
      host: config.host,
      http: config.http.enabled ? config.http.port : null,
      https: config.https.enabled ? config.https.port : null,
    },
  });

  const pool = createPool(config.database);
  const repository = createCitiesRepository(pool);
  const lineTypesRepository = createLineTypesRepository(pool);
  const projectSettingsRepository = createProjectSettingsRepository(pool);
  const reportConfigService = createReportConfigService(pool);
  const exportRepository = createDataExportRepository(pool);
  const publicDownloadRepository = createPublicDownloadRepository(pool);
  const publicDownloadService = createPublicDownloadService({
    repository: publicDownloadRepository,
    directory: path.join(config.projectRoot, 'var', 'public-downloads'),
  });
  const importService = createDataImportService(pool);
  const cityBoundaryTransferService = createCityBoundaryTransferService(pool);
  const populationService = createPopulationImportService(pool);
  const kmlUpdateService = createKmlUpdateService(pool, config.kmlUpdate);
  const osmCityUpdateService = createOsmCityUpdateService(pool, config.osmCityUpdate);
  const adminTaskSuccessRepository = createAdminTaskSuccessRepository(pool);
  const adminSecurityRepository = createAdminSecurityRepository(pool);
  const securityService = createAdminSecurityService(adminSecurityRepository);
  const adminAuth = createAdminAuthorization(securityService);

  const refreshPublicDownloads = (details = {}) => runServiceOperation(
    'public-downloads.refresh',
    () => publicDownloadService.refresh(),
    {
      details: {
        directory: publicDownloadService.directory,
        ...details,
      },
      successDetails: (result) => result,
    },
  );
  const refreshReportValues = (details = {}) => runServiceOperation(
    'city-report.refresh',
    () => reportConfigService.refresh(),
    {
      details,
      successDetails: (result) => result,
    },
  );

  await runServiceOperation(
    'database.health',
    () => repository.health(),
    {details: {schema: config.database.schema}},
  );
  await runServiceOperation(
    'admin-security.bootstrap',
    () => securityService.bootstrap({
      username: config.importApi.bootstrapUsername,
      password: config.importApi.bootstrapPassword,
    }),
    {
      successDetails: (result) => ({created: result.created}),
    },
  );
  await runServiceOperation(
    'project-settings.load',
    () => projectSettingsRepository.get(),
    {
      successDetails: (settings) => ({projectName: settings.projectName}),
    },
  );
  await refreshReportValues({reason: 'startup'});
  await refreshPublicDownloads({reason: 'startup'});
  const initialSuccessfulUpdates = await runServiceOperation(
    'admin-success-state.load',
    () => adminTaskSuccessRepository.list(),
    {
      successDetails: (updates) => ({records: updates.length}),
    },
  );

  const adminTasks = createAdminTaskManager({
    initialSuccessfulUpdates,
    recordSuccessfulUpdate: (update) => adminTaskSuccessRepository.record(update),
    recordTaskAudit: (entry) => securityService.appendAudit(entry),
    afterSuccessfulUpdate: async (update) => {
      if (!PUBLIC_DOWNLOAD_TASK_TYPES.has(update.taskType)) return undefined;
      const details = {
        reason: 'admin-update',
        taskType: update.taskType,
        taskId: update.taskId,
      };
      await refreshReportValues(details);
      return refreshPublicDownloads(details);
    },
  });
  const adminWebSocket = createAdminWebSocketGateway({
    adminTasks,
    adminAuth,
  });

  const app = createApp({
    repository,
    lineTypesRepository,
    projectSettingsRepository,
    reportConfigService,
    refreshPublicDownloads: () => refreshPublicDownloads({reason: 'report-config'}),
    exportRepository,
    importService,
    cityBoundaryTransferService,
    populationService,
    kmlUpdateService,
    osmCityUpdateService,
    adminTasks,
    adminAuth,
    securityService,
    config,
  });
  const servers = await runServiceOperation(
    'http-servers.start',
    () => startServers({
      app,
      config,
      webSocketGateway: adminWebSocket,
    }),
    {
      successDetails: (startedServers) => ({servers: startedServers.length}),
    },
  );
  serviceLog('info', 'startup:ready', {
    instance: config.database.schema,
    servers: servers.length,
  });
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) {
      serviceLog('warning', 'shutdown:duplicate', {signal});
      return;
    }
    shuttingDown = true;
    const startedAt = Date.now();
    serviceLog('info', 'shutdown:start', {signal});

    await runServiceOperation(
      'admin-websocket.close',
      () => adminWebSocket.close(),
    );
    const closeResults = await Promise.allSettled(
      servers.map((server) => closeServer(server)),
    );
    const failedServers = closeResults.filter((result) => result.status === 'rejected');
    if (failedServers.length > 0) {
      serviceLog('warning', 'http-servers.close:partial', {
        failed: failedServers.length,
        total: closeResults.length,
      });
    } else {
      serviceLog('info', 'http-servers.close:ok', {servers: closeResults.length});
    }
    await runServiceOperation('database.pool.close', () => pool.end());
    serviceLog('info', 'shutdown:ok', {
      signal,
      durationMs: Date.now() - startedAt,
    });
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      shutdown(signal)
        .then(() => process.exit(0))
        .catch((error) => {
          serviceLog('error', 'shutdown:error', {
            signal,
            ...serviceErrorDetails(error),
          });
          process.exit(1);
        });
    });
  }
}

main().catch((error) => {
  serviceLog('error', 'startup:error', serviceErrorDetails(error));
  process.exitCode = 1;
});
