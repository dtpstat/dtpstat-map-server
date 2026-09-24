import 'dotenv/config';
import path from 'node:path';
import {createApp} from './app.js';
import {loadConfig} from './config.js';
import {createAdminSecurityService} from './modules/security/service.js';
import {createAdminTaskManager} from './shared/tasks/admin-task-manager.js';
import {createPublicDownloadService} from './application/public-downloads/service.js';
import {createAdminSecurityRepository} from './db/admin-security-repository.js';
import {createAdminTaskSuccessRepository} from './db/admin-task-success-repository.js';
import {createCitiesRepository} from './db/cities-repository.js';
import {createCityBoundaryTransferService} from './db/city-boundary-transfer-service.js';
import {createDataExportRepository} from './db/data-export-repository.js';
import {createDataImportService} from './db/data-import-service.js';
import {createKmlUpdateService} from './db/kml-update-service.js';
import {createLineTypesRepository} from './db/line-types-repository.js';
import {createOsmCityUpdateService} from './db/osm-city-update-service.js';
import {createOsmCityCheckpointRepository} from './db/osm-city-checkpoint-repository.js';
import {createOsmImportSettingsRepository} from './db/osm-import-settings-repository.js';
import {createOsmBoundaryAdminRepository} from './db/osm-boundary-admin-repository.js';
import {createPopulationImportService} from './db/population-import-service.js';
import {createProjectSettingsRepository} from './db/project-settings-repository.js';
import {createProjectSettingsTransferService} from './db/project-settings-transfer-service.js';
import {createPublicDownloadRepository} from './db/public-download-repository.js';
import {createReportConfigService} from './db/report-config-service.js';
import {createPool} from './db/pool.js';
import {createAdminAuthorization} from './http/admin-auth.js';
import {createAdminWebSocketGateway} from './http/admin-websocket.js';
import {startServers} from './http/start-servers.js';
import {
  createAdminTaskDerivedRefresh,
  createDerivedStateRefresh,
} from './application/derived-state-refresh.js';
import {
  bootstrapServerApplication,
  prepareServerDatabase,
} from './application/server-bootstrap.js';
import {
  createServerShutdown,
  installProcessShutdownHandlers,
} from './application/server-lifecycle.js';
import {
  runServiceOperation,
  serviceErrorDetails,
  serviceLog,
} from './service-log.js';

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
  await prepareServerDatabase({
    config,
    pool,
  });

  const repository = createCitiesRepository(pool);
  const lineTypesRepository = createLineTypesRepository(pool);
  const projectSettingsRepository = createProjectSettingsRepository(pool, config.publicMap);
  const settingsTransferService = createProjectSettingsTransferService(pool);
  const reportConfigService = createReportConfigService(pool);
  const exportRepository = createDataExportRepository(pool);
  const publicDownloadRepository = createPublicDownloadRepository(pool);
  const publicDownloadService = createPublicDownloadService({
    repository: publicDownloadRepository,
    projectSettingsRepository,
    directory: path.join(config.projectRoot, 'var', 'public-downloads'),
  });
  const importService = createDataImportService(pool);
  const cityBoundaryTransferService = createCityBoundaryTransferService(pool);
  const populationService = createPopulationImportService(pool);
  const kmlUpdateService = createKmlUpdateService(pool, config.kmlUpdate);
  const osmImportSettingsRepository = createOsmImportSettingsRepository(pool);
  const osmBoundaryAdminRepository = createOsmBoundaryAdminRepository(pool);
  const osmCityCheckpointRepository = createOsmCityCheckpointRepository(pool);
  const osmCityUpdateService = createOsmCityUpdateService(
    pool,
    config.osmCityUpdate,
    {
      settingsRepository: osmImportSettingsRepository,
      checkpointRepository: osmCityCheckpointRepository,
    },
  );
  const adminTaskSuccessRepository = createAdminTaskSuccessRepository(pool);
  const adminSecurityRepository = createAdminSecurityRepository(pool);
  const securityService = createAdminSecurityService(adminSecurityRepository);
  const adminAuth = createAdminAuthorization(securityService);

  const derivedState = createDerivedStateRefresh({
    publicDownloadService,
    reportConfigService,
  });
  const {initialSuccessfulUpdates} = await bootstrapServerApplication({
    config,
    repository,
    osmImportSettingsRepository,
    securityService,
    projectSettingsRepository,
    adminTaskSuccessRepository,
    derivedState,
  });

  const adminTasks = createAdminTaskManager({
    initialSuccessfulUpdates,
    recordSuccessfulUpdate: (update) => adminTaskSuccessRepository.record(update),
    recordTaskAudit: (entry) => securityService.appendAudit(entry),
    afterSuccessfulUpdate:
      createAdminTaskDerivedRefresh(derivedState),
  });
  const adminWebSocket = createAdminWebSocketGateway({
    adminTasks,
    adminAuth,
  });

  const app = createApp({
    repository,
    lineTypesRepository,
    projectSettingsRepository,
    settingsTransferService,
    reportConfigService,
    refreshPublicDownloads: () =>
      derivedState.refreshPublicDownloads({reason: 'report-config'}),
    refreshPublicDownloadsAfterSettingsImport: () =>
      derivedState.refreshPublicDownloads({reason: 'project-settings-import'}),
    refreshProjectDerived: () =>
      derivedState.refreshAll({reason: 'project-settings'}),
    refreshOsmBoundaryDerived: () =>
      derivedState.refreshAll({reason: 'osm-boundary-settings'}),
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
  const shutdown = createServerShutdown({
    servers,
    adminWebSocket,
    pool,
  });
  installProcessShutdownHandlers({
    shutdown,
  });
}

main().catch((error) => {
  serviceLog('error', 'startup:error', serviceErrorDetails(error));
  process.exitCode = 1;
});
