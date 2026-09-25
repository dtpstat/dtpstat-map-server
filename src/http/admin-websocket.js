import { WebSocket, WebSocketServer } from 'ws';
import {
  adminHasPermission,
} from '../modules/security/authorization-policy.js';

/** @param {import('ws').WebSocket} socket @param {object} payload */
function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify(payload),
    );
  }
}

function rejectUpgrade(
  socket,
  status,
  reason,
  headers = [],
) {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n` +
    'Cache-Control: no-store\r\n' +
    headers
      .map(
        ([name, value]) =>
          `${name}: ${value}\r\n`,
      )
      .join('') +
    'Connection: close\r\n\r\n',
  );
  socket.destroy();
}

function filteredRealtimeSnapshot(
  realtimeEvents,
  user,
) {
  const snapshot =
    realtimeEvents.snapshot();
  return {
    sequence: snapshot.sequence,
    resources:
      Object.fromEntries(
        Object.entries(
          snapshot.resources,
        ).filter(
          ([, value]) =>
            adminHasPermission(
              user,
              value.permission ??
              'any',
            ),
        ),
      ),
  };
}

export function createAdminWebSocketGateway({
  adminTasks,
  adminAuth,
  realtimeEvents,
  path = '/api/admin/ws',
}) {
  const webSocketServer =
    new WebSocketServer({
      noServer: true,
    });
  const attachedServers =
    new Map();
  const clientUsers =
    new WeakMap();

  const forPermittedClients =
    (permission, callback) => {
      for (
        const client of
        webSocketServer.clients
      ) {
        const user =
          clientUsers.get(client);
        if (
          !adminHasPermission(
            user,
            permission,
          )
        ) {
          continue;
        }
        callback(client);
      }
    };

  const unsubscribeTasks =
    adminTasks.subscribe(
      (event) => {
        forPermittedClients(
          'data',
          (client) =>
            send(client, event),
        );
      },
    );

  const unsubscribeRealtime =
    realtimeEvents.subscribe(
      (message) => {
        const permission =
          message.change
            ?.permission ??
          'any';
        forPermittedClients(
          permission,
          (client) =>
            send(client, message),
        );
      },
    );

  webSocketServer.on(
    'connection',
    (
      socket,
      _request,
      authorization,
    ) => {
      const user =
        authorization?.user ??
        null;
      clientUsers.set(
        socket,
        user,
      );

      const canManageData =
        adminHasPermission(
          user,
          'data',
        );
      send(
        socket,
        {
          type: 'snapshot',
          task:
            canManageData
              ? adminTasks.current()
              : null,
          lastSuccessfulUpdates:
            canManageData
              ? adminTasks
                .successfulUpdates()
              : {},
          realtime:
            filteredRealtimeSnapshot(
              realtimeEvents,
              user,
            ),
        },
      );

      socket.on(
        'error',
        (error) =>
          console.error(
            'Admin WebSocket client failed',
            error.message,
          ),
      );
    },
  );

  return {
    /** @param {import('node:http').Server} server */
    attach(server) {
      if (
        attachedServers.has(server)
      ) {
        return;
      }

      const upgrade =
        (
          request,
          socket,
          head,
        ) => {
          let pathname;
          try {
            pathname =
              new URL(
                request.url,
                'http://localhost',
              ).pathname;
          } catch {
            return;
          }
          if (pathname !== path) {
            return;
          }

          void adminAuth
            .authenticateUpgrade(
              request,
              'any',
            )
            .then((result) => {
              if (
                result.status ===
                'success'
              ) {
                webSocketServer
                  .handleUpgrade(
                    request,
                    socket,
                    head,
                    (webSocket) => {
                      webSocketServer
                        .emit(
                          'connection',
                          webSocket,
                          request,
                          result,
                        );
                    },
                  );
                return;
              }
              if (
                result.status ===
                'locked'
              ) {
                rejectUpgrade(
                  socket,
                  423,
                  'Locked',
                  [[
                    'Retry-After',
                    String(
                      result
                        .retryAfterSeconds ??
                      1,
                    ),
                  ]],
                );
                return;
              }
              if (
                result.status ===
                'ip-locked'
              ) {
                rejectUpgrade(
                  socket,
                  429,
                  'Too Many Requests',
                  [[
                    'Retry-After',
                    String(
                      result
                        .retryAfterSeconds ??
                      1,
                    ),
                  ]],
                );
                return;
              }
              if (
                [
                  'blocked',
                  'ip-blocked',
                  'forbidden',
                  'password-change-required',
                ].includes(
                  result.status,
                )
              ) {
                rejectUpgrade(
                  socket,
                  403,
                  'Forbidden',
                );
                return;
              }
              rejectUpgrade(
                socket,
                401,
                'Unauthorized',
                [[
                  'WWW-Authenticate',
                  'Basic realm="dtpstat-admin", charset="UTF-8"',
                ]],
              );
            })
            .catch((error) => {
              console.error(
                'Admin WebSocket authentication failed',
                error,
              );
              rejectUpgrade(
                socket,
                503,
                'Service Unavailable',
              );
            });
        };

      attachedServers.set(
        server,
        upgrade,
      );
      server.on(
        'upgrade',
        upgrade,
      );
    },

    async close() {
      unsubscribeTasks();
      unsubscribeRealtime();

      for (
        const [
          server,
          upgrade,
        ] of
        attachedServers
      ) {
        server.off(
          'upgrade',
          upgrade,
        );
      }
      attachedServers.clear();

      for (
        const client of
        webSocketServer.clients
      ) {
        client.terminate();
      }

      await new Promise(
        (resolve) =>
          webSocketServer.close(
            () => resolve(),
          ),
      );
    },
  };
}
