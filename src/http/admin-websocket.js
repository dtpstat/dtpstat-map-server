import { WebSocket, WebSocketServer } from 'ws';
import {
  adminHasPermission,
} from '../modules/security/authorization-policy.js';
import {
  DTPSTAT_API_VERSION,
} from '../../public/js/api-contract.js';
import {
  adminWebSocketOriginAllowed,
} from './admin-origin.js';
import {
  requestClientIp,
} from '../shared/http/client-ip.js';
import {
  securityLog,
} from '../service-log.js';

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
  notificationEvents = null,
  allowedOrigins = new Set(),
  securityService = null,
  path = '/api/admin/ws',
}) {
  const webSocketServer =
    new WebSocketServer({
      noServer: true,
    });
  const attachedServers =
    new Map();
  const clientContexts =
    new WeakMap();

  const audienceMatches =
    (
      context,
      audience,
    ) => {
      if (!audience) {
        return true;
      }

      if (
        audience.excludeSessionIds
          ?.includes(
            context.sessionId,
          )
      ) {
        return false;
      }

      const hasPositiveTarget =
        Boolean(
          audience.userIds
            ?.length ||
          audience.sessionIds
            ?.length,
        );

      if (!hasPositiveTarget) {
        return true;
      }

      return Boolean(
        audience.userIds
          ?.includes(
            context.userId,
          ) ||
        audience.sessionIds
          ?.includes(
            context.sessionId,
          ),
      );
    };

  const sendSessionLogout =
    (
      client,
      reason,
    ) => {
      send(
        client,
        {
          type:
            'session-control',
          action:
            'logout',
          reason:
            String(
              reason ??
              'session-invalid',
            ).slice(
              0,
              160,
            ),
        },
      );

      if (
        client.readyState ===
        WebSocket.OPEN
      ) {
        client.close(
          4001,
          'Session invalid',
        );
      }
    };

  const enqueueDelivery =
    (
      client,
      {
        permission =
          'any',
        payload,
        audience =
          null,
      },
    ) => {
      const context =
        clientContexts.get(
          client,
        );
      if (
        !context ||
        !audienceMatches(
          context,
          audience,
        )
      ) {
        return;
      }

      context.queue =
        context.queue
          .then(
            async () => {
              if (
                client.readyState !==
                WebSocket.OPEN
              ) {
                return;
              }

              let user =
                context.user;

              if (
                (
                  securityService
                    ?.authenticateRealtime ||
                  securityService
                    ?.authenticateRequest
                ) &&
                context.sessionToken
              ) {
                const authenticate =
                  securityService
                    .authenticateRealtime ??
                  securityService
                    .authenticateRequest;
                const current =
                  await authenticate.call(
                    securityService,
                    {
                      sessionToken:
                        context.sessionToken,
                      ipAddress:
                        context.ipAddress,
                      userAgent:
                        context.userAgent,
                    },
                  );

                if (
                  current.status !==
                    'success' ||
                  current.user
                    ?.mustChangePassword
                ) {
                  sendSessionLogout(
                    client,
                    'session-' +
                      current.status,
                  );
                  return;
                }

                user =
                  current.user;
                context.user =
                  user;
                context.userId =
                  user.id;
                context.sessionId =
                  current.sessionId ??
                  context.sessionId;
              }

              if (
                !adminHasPermission(
                  user,
                  permission,
                )
              ) {
                return;
              }

              if (
                !audienceMatches(
                  context,
                  audience,
                )
              ) {
                return;
              }

              send(
                client,
                payload,
              );
            },
          )
          .catch(
            (error) => {
              console.error(
                'Admin WebSocket authorization refresh failed',
                error,
              );
              sendSessionLogout(
                client,
                'authorization-refresh-failed',
              );
            },
          );
    };

  const forAuthorizedClients =
    (
      definition,
    ) => {
      for (
        const client of
        webSocketServer.clients
      ) {
        enqueueDelivery(
          client,
          definition,
        );
      }
    };

  const unsubscribeTasks =
    adminTasks.subscribe(
      (event) => {
        forAuthorizedClients({
          permission:
            'data',
          payload:
            event,
        });
      },
    );

  const unsubscribeRealtime =
    realtimeEvents.subscribe(
      (message) => {
        const permission =
          message.change
            ?.permission ??
          'any';
        forAuthorizedClients({
          permission,
          payload:
            message,
        });
      },
    );

  const unsubscribeNotifications =
    notificationEvents
      ?.subscribe?.(
        (event) => {
          const notification =
            event?.notification;
          if (!notification) {
            return;
          }

          forAuthorizedClients({
            permission:
              event.delivery
                ?.permission ??
              'any',
            audience:
              event.delivery
                ?.audience ??
              null,
            payload: {
              type:
                'notification',
              notification,
            },
          });
        },
      ) ??
    (() => {});

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
      clientContexts.set(
        socket,
        {
          user,
          userId:
            user?.id ??
            null,
          sessionId:
            authorization
              ?.sessionId ??
            null,
          sessionToken:
            authorization
              ?.token ??
            null,
          ipAddress:
            requestClientIp(
              _request,
            ),
          userAgent:
            _request.headers[
              'user-agent'
            ],
          queue:
            Promise.resolve(),
        },
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

          if (
            !adminWebSocketOriginAllowed(
              request,
              allowedOrigins,
            )
          ) {
            const ipAddress =
              requestClientIp(
                request,
              );

            securityLog(
              'admin.websocket.origin_rejected',
              {
                ip:
                  ipAddress,
                origin:
                  request.headers
                    .origin ??
                  null,
                path,
              },
            );

            void Promise.resolve(
              securityService
                ?.recordRequestSecurityIncident?.(
                  ipAddress,
                  {
                    reason:
                      'websocket-origin-rejected',
                    method:
                      'GET',
                    path,
                    fields: [
                      {
                        source:
                          'header',
                        key:
                          'origin',
                      },
                    ],
                  },
                ),
            ).catch(
              (error) =>
                console.error(
                  'Admin WebSocket security incident recording failed',
                  error,
                ),
            );

            rejectUpgrade(
              socket,
              403,
              'Forbidden',
            );
            return;
          }

          const expectedProtocol =
            'dtpstat-api-v' +
            DTPSTAT_API_VERSION;
          const protocols =
            String(
              request.headers[
                'sec-websocket-protocol'
              ] ??
              '',
            )
              .split(',')
              .map(
                (value) =>
                  value.trim(),
              )
              .filter(Boolean);

          if (
            !protocols.includes(
              expectedProtocol,
            )
          ) {
            rejectUpgrade(
              socket,
              426,
              'Upgrade Required',
              [[
                'X-DTPStat-API-Version-Required',
                DTPSTAT_API_VERSION,
              ]],
            );
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
      unsubscribeNotifications();

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
