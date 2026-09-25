import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';
import {
  createRealtimeEventBus,
} from '../src/shared/events/realtime-event-bus.js';
import {
  createAdminTaskManager,
} from '../src/shared/tasks/admin-task-manager.js';
import {
  createAdminWebSocketGateway,
} from '../src/http/admin-websocket.js';

const dataAuthorization =
  `Basic ${Buffer.from('importer:test:secret').toString('base64')}`;
const osmAuthorization =
  `Basic ${Buffer.from('osm:test:secret').toString('base64')}`;

function testAdminAuth() {
  return {
    async authenticateUpgrade(
      request,
      permission,
    ) {
      assert.equal(
        permission,
        'any',
      );

      if (
        request.headers.authorization ===
        dataAuthorization
      ) {
        return {
          status: 'success',
          user: {
            id: 1,
            username: 'importer',
            canManageData: true,
            canEditOsm: false,
            isSuperuser: false,
          },
        };
      }

      if (
        request.headers.authorization ===
        osmAuthorization
      ) {
        return {
          status: 'success',
          user: {
            id: 2,
            username: 'osm-editor',
            canManageData: false,
            canEditOsm: true,
            isSuperuser: false,
          },
        };
      }

      return {
        status: 'invalid',
        user: null,
      };
    },
  };
}

async function openSocket(
  url,
  authorization,
  messages,
) {
  const socket =
    new WebSocket(
      url,
      {
        headers: {
          Authorization:
            authorization,
        },
      },
    );
  socket.on(
    'message',
    (data) =>
      messages.push(
        JSON.parse(
          data.toString(),
        ),
      ),
  );
  await new Promise(
    (resolve, reject) => {
      socket.once(
        'open',
        resolve,
      );
      socket.once(
        'error',
        reject,
      );
    },
  );
  await new Promise(
    (resolve) =>
      setImmediate(resolve),
  );
  return socket;
}

test('admin WebSocket streams task events only to data managers and resource events by capability', async () => {
  const adminTasks =
    createAdminTaskManager({
      randomUUID:
        () => 'ws-task',
    });
  const realtimeEvents =
    createRealtimeEventBus({
      randomUUID:
        () => 'change-1',
      now:
        () =>
          '2026-09-25T12:00:00.000Z',
    });
  const gateway =
    createAdminWebSocketGateway({
      adminTasks,
      adminAuth:
        testAdminAuth(),
      realtimeEvents,
    });
  const server =
    http.createServer(
      (_request, response) =>
        response.end(),
    );
  gateway.attach(server);
  await new Promise(
    (resolve) =>
      server.listen(
        0,
        '127.0.0.1',
        resolve,
      ),
  );
  const address =
    server.address();
  const url =
    `ws://127.0.0.1:${address.port}/api/admin/ws`;

  const unauthorized =
    new WebSocket(url);
  await assert.rejects(
    new Promise(
      (resolve, reject) => {
        unauthorized.once(
          'open',
          resolve,
        );
        unauthorized.once(
          'error',
          reject,
        );
      },
    ),
    /401/u,
  );

  const dataMessages = [];
  const osmMessages = [];
  const dataSocket =
    await openSocket(
      url,
      dataAuthorization,
      dataMessages,
    );
  const osmSocket =
    await openSocket(
      url,
      osmAuthorization,
      osmMessages,
    );

  assert.deepEqual(
    dataMessages[0],
    {
      type: 'snapshot',
      task: null,
      lastSuccessfulUpdates: {},
      realtime: {
        sequence: 0,
        resources: {},
      },
    },
  );
  assert.deepEqual(
    osmMessages[0],
    {
      type: 'snapshot',
      task: null,
      lastSuccessfulUpdates: {},
      realtime: {
        sequence: 0,
        resources: {},
      },
    },
  );

  adminTasks.start(
    {
      type:
        'osm-city-update',
      endpoint:
        '/api/admin/update/cities',
    },
    async (context) => {
      context.log(
        'OSM: обработан пакет 1/2',
        {
          batch: 1,
          batchCount: 2,
        },
      );
      return {
        importedPlaces: 100,
      };
    },
  );
  await new Promise(
    (resolve) =>
      setImmediate(resolve),
  );
  await new Promise(
    (resolve) =>
      setImmediate(resolve),
  );

  assert.ok(
    dataMessages.some(
      (message) =>
        message.type === 'log' &&
        message.entry.message ===
          'OSM: обработан пакет 1/2',
    ),
  );
  assert.equal(
    osmMessages.some(
      (message) =>
        message.type === 'log' ||
        message.type === 'task' ||
        message.type === 'success',
    ),
    false,
  );

  realtimeEvents.publish({
    resource: 'osm-boundaries',
    permission: 'osm-editor',
    entityIds: [5],
    message:
      'OSM changed',
  });
  await new Promise(
    (resolve) =>
      setImmediate(resolve),
  );

  assert.equal(
    dataMessages.some(
      (message) =>
        message.type ===
          'data-change',
    ),
    false,
  );
  assert.ok(
    osmMessages.some(
      (message) =>
        message.type ===
          'data-change' &&
        message.change.resource ===
          'osm-boundaries',
    ),
  );

  dataSocket.close();
  osmSocket.close();
  await gateway.close();
  await new Promise(
    (resolve, reject) =>
      server.close(
        (error) =>
          error
            ? reject(error)
            : resolve(),
      ),
  );
});
