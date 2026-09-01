import { WebSocket, WebSocketServer } from 'ws';
import { verifyBasicAuthorization } from './basic-auth.js';

/** @param {import('ws').WebSocket} socket @param {object} payload */
function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

/**
 * @param {{
 *   adminTasks: ReturnType<import('../data/admin-task-manager.js').createAdminTaskManager>,
 *   importApi: { username: string, password: string },
 *   path?: string
 * }} dependencies
 */
export function createAdminWebSocketGateway({
  adminTasks,
  importApi,
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
        if (!verifyBasicAuthorization(request.headers.authorization, importApi)) {
          socket.write(
            'HTTP/1.1 401 Unauthorized\r\n' +
            'WWW-Authenticate: Basic realm="data-import", charset="UTF-8"\r\n' +
            'Cache-Control: no-store\r\n' +
            'Connection: close\r\n\r\n',
          );
          socket.destroy();
          return;
        }
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          webSocketServer.emit('connection', webSocket, request);
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
