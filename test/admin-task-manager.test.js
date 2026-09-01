import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminTaskAlreadyRunningError,
  createAdminTaskManager,
} from '../src/data/admin-task-manager.js';

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('admin task retains its accumulated log and result until another starts', async () => {
  let taskNumber = 0;
  const manager = createAdminTaskManager({
    randomUUID() {
      taskNumber += 1;
      return `task-${taskNumber}`;
    },
  });
  const events = [];
  const unsubscribe = manager.subscribe((event) => events.push(event));
  const accepted = manager.start({
    type: 'osm-cities',
    endpoint: '/api/admin/update/cities',
    parameters: { dryRun: true },
  }, async (context) => {
    context.log('Получен индекс OSM', { indexedPlaces: 2664 });
    context.log('Обработан пакет', { batch: 1, batchCount: 54 });
    return { importedPlaces: 2664 };
  });

  assert.equal(accepted.status, 'queued');
  assert.equal(accepted.log.length, 1);
  await nextTurn();

  const completed = manager.get('task-1');
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.log.map((entry) => entry.message), [
    'Задача принята сервером',
    'Задача запущена',
    'Получен индекс OSM',
    'Обработан пакет',
    'Задача успешно завершена',
  ]);
  assert.deepEqual(completed.result, { importedPlaces: 2664 });
  assert.ok(events.some((event) =>
    event.type === 'log' && event.entry.message === 'Обработан пакет'));
  assert.ok(events.some((event) =>
    event.type === 'task' && event.task.status === 'succeeded'));

  manager.start({
    type: 'population',
    endpoint: '/api/admin/populations',
  }, async () => ({ cities: 1 }));
  assert.equal(manager.get('task-1'), null);
  assert.equal(manager.get('task-2').log.length, 1);
  await nextTurn();
  unsubscribe();
});

test('admin task cancellation is cooperative and disabled during atomic commit', async () => {
  let finishTask;
  const manager = createAdminTaskManager({ randomUUID: () => 'cancel-task' });
  manager.start({
    type: 'geojson',
    endpoint: '/api/admin/import',
  }, (context) => new Promise((resolve, reject) => {
    finishTask = resolve;
    context.signal.addEventListener(
      'abort',
      () => reject(context.signal.reason),
      { once: true },
    );
  }));
  await nextTurn();

  const cancellation = manager.cancel('cancel-task');
  assert.equal(cancellation.accepted, true);
  assert.equal(cancellation.task.status, 'cancelling');
  await nextTurn();
  assert.equal(manager.get('cancel-task').status, 'cancelled');

  let finishCommit;
  const committedManager = createAdminTaskManager({
    randomUUID: () => 'commit-task',
  });
  committedManager.start({
    type: 'population',
    endpoint: '/api/admin/populations',
  }, (context) => {
    context.beginCommit();
    return new Promise((resolve) => {
      finishCommit = resolve;
    });
  });
  await nextTurn();
  const tooLate = committedManager.cancel('commit-task');
  assert.equal(tooLate.accepted, false);
  assert.equal(tooLate.task.cancellable, false);
  finishCommit({ cities: 1 });
  await nextTurn();
  assert.equal(committedManager.get('commit-task').status, 'succeeded');

  assert.equal(typeof finishTask, 'function');
});

test('one active admin task blocks every other task type and records failures', async () => {
  let rejectTask;
  const manager = createAdminTaskManager({ randomUUID: () => 'active-task' });
  manager.start({
    type: 'kml',
    endpoint: '/api/admin/update',
  }, () => new Promise((_resolve, reject) => {
    rejectTask = reject;
  }));

  assert.throws(
    () => manager.start({
      type: 'population',
      endpoint: '/api/admin/populations',
    }, async () => ({})),
    (error) =>
      error instanceof AdminTaskAlreadyRunningError &&
      error.task.id === 'active-task' &&
      error.task.type === 'kml',
  );

  await nextTurn();
  rejectTask(new Error('Download timeout'));
  await nextTurn();
  const failed = manager.get('active-task');
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.error, {
    name: 'Error',
    message: 'Download timeout',
  });
  assert.equal(failed.log.at(-1).level, 'error');
});

test('successful update timestamps persist by task type and ignore dry runs', async () => {
  const recorded = [];
  let taskNumber = 0;
  const initial = {
    taskType: 'osm-city-update',
    taskId: null,
    endpoint: '/api/admin/update/cities',
    completedAt: '2026-08-30T09:00:00.000Z',
  };
  const manager = createAdminTaskManager({
    initialSuccessfulUpdates: [initial],
    randomUUID: () => `task-${taskNumber += 1}`,
    recordSuccessfulUpdate: async (update) => recorded.push(update),
    now: () => '2026-09-01T10:00:00.000Z',
  });

  assert.deepEqual(manager.successfulUpdates(), {
    'osm-city-update': initial,
  });

  manager.start({
    type: 'osm-city-update',
    endpoint: '/api/admin/update/cities',
    parameters: { dryRun: true },
    recordsSuccessfulUpdate: false,
  }, async () => ({ dryRun: true }));
  await nextTurn();
  assert.deepEqual(manager.successfulUpdates(), {
    'osm-city-update': initial,
  });
  assert.equal(recorded.length, 0);

  manager.start({
    type: 'population-update',
    endpoint: '/api/admin/populations',
    recordsSuccessfulUpdate: true,
  }, async () => ({ cities: 71 }));
  await nextTurn();
  assert.deepEqual(manager.successfulUpdates()['population-update'], {
    taskType: 'population-update',
    taskId: 'task-2',
    endpoint: '/api/admin/populations',
    completedAt: '2026-09-01T10:00:00.000Z',
  });
  assert.equal(recorded.length, 1);
});
