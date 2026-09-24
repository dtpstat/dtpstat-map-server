import {
  closeServer,
} from '../http/start-servers.js';
import {
  runServiceOperation,
  serviceErrorDetails,
  serviceLog,
} from '../service-log.js';

/**
 * Build the idempotent shutdown sequence for one running application instance.
 *
 * @param {{
 *   servers: import('node:http').Server[],
 *   adminWebSocket: { close: () => Promise<any> | any },
 *   pool: { end: () => Promise<any> | any },
 *   closeHttpServer?: (server: any) => Promise<any>,
 *   runOperation?: typeof runServiceOperation,
 *   log?: typeof serviceLog,
 *   now?: () => number
 * }} dependencies
 */
export function createServerShutdown({
  servers,
  adminWebSocket,
  pool,
  closeHttpServer = closeServer,
  runOperation = runServiceOperation,
  log = serviceLog,
  now = Date.now,
}) {
  let shuttingDown = false;

  return async function shutdown(signal) {
    if (shuttingDown) {
      log(
        'warning',
        'shutdown:duplicate',
        { signal },
      );
      return;
    }

    shuttingDown = true;
    const startedAt = now();

    log(
      'info',
      'shutdown:start',
      { signal },
    );

    await runOperation(
      'admin-websocket.close',
      () => adminWebSocket.close(),
    );

    const closeResults =
      await Promise.allSettled(
        servers.map(
          (server) =>
            closeHttpServer(server),
        ),
      );

    const failedServers =
      closeResults.filter(
        (result) =>
          result.status ===
          'rejected',
      );

    if (failedServers.length > 0) {
      log(
        'warning',
        'http-servers.close:partial',
        {
          failed:
            failedServers.length,
          total:
            closeResults.length,
        },
      );
    } else {
      log(
        'info',
        'http-servers.close:ok',
        {
          servers:
            closeResults.length,
        },
      );
    }

    await runOperation(
      'database.pool.close',
      () => pool.end(),
    );

    log(
      'info',
      'shutdown:ok',
      {
        signal,
        durationMs:
          now() - startedAt,
      },
    );
  };
}

/**
 * Bind process signals to the shutdown sequence. The process exits only after
 * application resources have been closed or the shutdown sequence has failed.
 *
 * @param {{
 *   shutdown: (signal: string) => Promise<void>,
 *   processRuntime?: Pick<NodeJS.Process, 'once' | 'exit'>,
 *   log?: typeof serviceLog
 * }} dependencies
 */
export function installProcessShutdownHandlers({
  shutdown,
  processRuntime = process,
  log = serviceLog,
}) {
  for (
    const signal of
    ['SIGINT', 'SIGTERM']
  ) {
    processRuntime.once(
      signal,
      () =>
        shutdown(signal)
          .then(() => {
            processRuntime.exit(0);
          })
          .catch((error) => {
            log(
              'error',
              'shutdown:error',
              {
                signal,
                ...serviceErrorDetails(
                  error,
                ),
              },
            );
            processRuntime.exit(1);
          }),
    );
  }
}
