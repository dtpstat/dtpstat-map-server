import { WebSocket, WebSocketServer } from 'ws';

/** @param {import('ws').WebSocket} socket @param {object} payload */
function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function rejectUpgrade(socket, status, reason, headers = []) {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n` +
    'Cache-Control: no-store\r\n' +
    headers.map(([name, value]) => `${name}: ${value}\r\n`).join('') +
    'Connection: close\r\n\r\n',
  );
  socket.destroy();
}

/**
 * @param {{
 *   adminTasks: ReturnType<import('../data/admin-task-manager.js').createAdminTaskManager>,
 *   adminAuth: ReturnType<import('./admin-auth.js').createAdminAuthorization>,
 *   path?: string
 * }} dependencies
 */
export function createAdminWebSocketGateway({
  adminTasks,
  adminAuth,
  path = '/api/admin/ws',
}) {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const attachedServers = new Map();
  const unsubscribe = adminTasks.subscribe((event) => {
    for (const client of webSocketServer.clients) send(client, event);
  });

  webSocketServer.on('connection', (socket) => {
    send(socket, {
      type: 'snapshot',
      task: adminTasks.current(),
      lastSuccessfulUpdates: adminTasks.successfulUpdates(),
    });
    socket.on('error', (error) => {
      console.error('Admin WebSocket client failed', error.message);
    });
  });

  return {
    /** @param {import('node:http').Server} server */
    attach(server) {
      if (attachedServers.has(server)) return;
      const upgrade = (request, socket, head) => {
        let pathname;
        try {
          pathname = new URL(request.url, 'http://localhost').pathname;
        } catch {
          return;
        }
        if (pathname !== path) return;
        void adminAuth.authenticateUpgrade(request, 'data')
          .then((result) => {
            if (result.status === 'success') {
              webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
                webSocketServer.emit('connection', webSocket, request);
              });
              return;
            }
            if (result.status === 'locked') {
              rejectUpgrade(socket, 423, 'Locked', [
                ['Retry-After', String(result.retryAfterSeconds ?? 1)],
              ]);
              return;
            }
            if (result.status === 'blocked' || result.status === 'forbidden') {
              rejectUpgrade(socket, 403, 'Forbidden');
              return;
            }
            rejectUpgrade(socket, 401, 'Unauthorized', [
              ['WWW-Authenticate', 'Basic realm="dtpstat-admin", charset="UTF-8"'],
            ]);
          })
          .catch((error) => {
            console.error('Admin WebSocket authentication failed', error);
            rejectUpgrade(socket, 503, 'Service Unavailable');
          });
      };
      attachedServers.set(server, upgrade);
      server.on('upgrade', upgrade);
    },

    async close() {
      unsubscribe();
      for (const [server, upgrade] of attachedServers) {
        server.off('upgrade', upgrade);
      }
      attachedServers.clear();
      for (const client of webSocketServer.clients) client.terminate();
      await new Promise((resolve) => webSocketServer.close(() => resolve()));
    },
  };
}
