import 'dotenv/config';
import {createApp} from './app.js';
import {loadConfig} from './config.js';
import {createAdminTaskManager} from './shared/tasks/admin-task-manager.js';
import {createPool} from './db/pool.js';
import {createAdminWebSocketGateway} from './http/admin-websocket.js';
import {startServers} from './http/start-servers.js';
import {
  createAdminTaskDerivedRefresh,
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
  createServerRuntime,
} from './application/server-runtime.js';
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

  const runtime =
    createServerRuntime({
      pool,
      config,
    });

  const {initialSuccessfulUpdates} =
    await bootstrapServerApplication(
      runtime.bootstrapDependencies,
    );

  const adminTasks = createAdminTaskManager({
    initialSuccessfulUpdates,
    recordSuccessfulUpdate:
      (update) =>
        runtime
          .adminTaskSuccessRepository
          .record(update),
    recordTaskAudit:
      (entry) =>
        runtime
          .securityService
          .appendAudit(entry),
    afterSuccessfulUpdate:
      createAdminTaskDerivedRefresh(
        runtime.derivedState,
      ),
  });
  const adminWebSocket =
    createAdminWebSocketGateway({
      adminTasks,
      adminAuth:
        runtime.adminAuth,
    });

  const app = createApp({
    ...runtime.appDependencies,
    adminTasks,
  });
  const servers = await runServiceOperation(
    'http-servers.start',
    () => startServers({
      app,
      config,
      webSocketGateway: adminWebSocket,
    }),
    {
      successDetails:
        (startedServers) => ({
          servers:
            startedServers.length,
        }),
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
  serviceLog(
    'error',
    'startup:error',
    serviceErrorDetails(error),
  );
  process.exitCode = 1;
});
