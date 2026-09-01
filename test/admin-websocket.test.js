import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createAdminTaskManager } from '../src/data/admin-task-manager.js';
import { createAdminWebSocketGateway } from '../src/http/admin-websocket.js';

const credentials = {
  username: 'importer',
  password: 'test:secret',
};
const authorization = `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;

test('admin WebSocket requires Basic Auth and streams task log events', async () => {
  const adminTasks = createAdminTaskManager({ randomUUID: () => 'ws-task' });
  const gateway = createAdminWebSocketGateway({
    adminTasks,
    importApi: credentials,
  });
  const server = http.createServer((_request, response) => response.end());
  gateway.attach(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}/api/admin/ws`;

  const unauthorized = new WebSocket(url);
  await assert.rejects(
    new Promise((resolve, reject) => {
      unauthorized.once('open', resolve);
      unauthorized.once('error', reject);
    }),
    /401/,
  );

  const messages = [];
  const socket = new WebSocket(url, { headers: { Authorization: authorization } });
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(messages[0], {
    type: 'snapshot',
    task: null,
    lastSuccessfulUpdates: {},
  });

  adminTasks.start({
    type: 'osm-city-update',
    endpoint: '/api/admin/update/cities',
  }, async (context) => {
    context.log('OSM: обработан пакет 1/2', { batch: 1, batchCount: 2 });
    return { importedPlaces: 100 };
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(messages.some((message) =>
    message.type === 'log' &&
    message.entry.message === 'OSM: обработан пакет 1/2'));
  assert.ok(messages.some((message) =>
    message.type === 'task' &&
    message.task.id === 'ws-task' &&
    message.task.status === 'succeeded'));
  assert.ok(messages.some((message) =>
    message.type === 'success' &&
    message.update.taskType === 'osm-city-update'));

  socket.close();
  await gateway.close();
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
});
