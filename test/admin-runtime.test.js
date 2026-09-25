import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminRuntime,
} from '../src/application/admin-runtime.js';

test('admin runtime composes task persistence derived refresh and websocket authorization', async () => {
  const calls = [];
  const initialSuccessfulUpdates = [
    {
      taskType: 'kml-update',
      taskId: 'task-1',
    },
  ];
  const derivedState = {
    marker: 'derived',
  };
  const adminAuth = {
    marker: 'auth',
  };
  const recorded = [];
  const audits = [];
  let managerOptions;

  const adminTasks = {
    marker: 'tasks',
  };
  const adminWebSocket = {
    marker: 'websocket',
  };
  const published = [];
  const realtimeEvents = {
    marker: 'realtime',
    publish(change) {
      published.push(change);
      return change;
    },
  };
  const afterSuccessfulUpdate = async () => ({
    refreshed: true,
  });

  const runtime =
    createAdminRuntime({
      initialSuccessfulUpdates,
      adminTaskSuccessRepository: {
        async record(update) {
          recorded.push(update);
        },
      },
      securityService: {
        async appendAudit(entry) {
          audits.push(entry);
        },
      },
      adminAuth,
      derivedState,
      factories: {
        createRealtimeEventBus() {
          calls.push(
            'realtime-bus',
          );
          return realtimeEvents;
        },
        createAdminTaskDerivedRefresh(
          receivedDerivedState,
        ) {
          assert.equal(
            receivedDerivedState,
            derivedState,
          );
          calls.push(
            'derived-hook',
          );
          return afterSuccessfulUpdate;
        },
        createAdminTaskManager(options) {
          managerOptions = options;
          calls.push(
            'task-manager',
          );
          return adminTasks;
        },
        createAdminWebSocketGateway(
          options,
        ) {
          assert.equal(
            options.adminTasks,
            adminTasks,
          );
          assert.equal(
            options.adminAuth,
            adminAuth,
          );
          assert.equal(
            options.realtimeEvents,
            realtimeEvents,
          );
          calls.push(
            'websocket',
          );
          return adminWebSocket;
        },
      },
    });

  assert.deepEqual(
    calls,
    [
      'realtime-bus',
      'derived-hook',
      'task-manager',
      'websocket',
    ],
  );
  assert.equal(
    runtime.adminTasks,
    adminTasks,
  );
  assert.equal(
    runtime.adminWebSocket,
    adminWebSocket,
  );
  assert.equal(
    runtime.realtimeEvents,
    realtimeEvents,
  );
  assert.equal(
    managerOptions
      .initialSuccessfulUpdates,
    initialSuccessfulUpdates,
  );
  assert.notEqual(
    managerOptions
      .afterSuccessfulUpdate,
    afterSuccessfulUpdate,
  );
  assert.deepEqual(
    await managerOptions
      .afterSuccessfulUpdate({
        taskType:
          'population-update',
        taskId: 'task-2',
      }),
    {
      refreshed: true,
    },
  );
  assert.deepEqual(
    published,
    [{
      resource:
        'osm-boundaries',
      permission:
        'osm-editor',
      message:
        'Данные территорий обновлены. Открытые редакторы синхронизированы.',
      action:
        'refresh',
      source: {
        kind: 'admin-task',
        id: 'task-2',
        taskType:
          'population-update',
      },
    }],
  );

  const update = {
    taskType: 'population-update',
  };
  const audit = {
    operationType:
      'population-update',
  };

  await managerOptions
    .recordSuccessfulUpdate(update);
  await managerOptions
    .recordTaskAudit(audit);

  assert.deepEqual(
    recorded,
    [update],
  );
  assert.deepEqual(
    audits,
    [audit],
  );
});
