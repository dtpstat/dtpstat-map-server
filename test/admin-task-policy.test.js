import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminTaskCancelledError,
  adminTaskSnapshot,
  elapsedAdminTaskMilliseconds,
  isAdminTaskActiveStatus,
  throwIfAdminTaskCancelled,
} from '../src/shared/tasks/admin-task-policy.js';

test('admin task policy snapshots only public task state', () => {
  const controller = new AbortController();
  const task = {
    id: 'task-1',
    type: 'population-update',
    endpoint: '/api/admin/populations',
    status: 'running',
    parameters: { dryRun: true },
    actor: { userId: 7 },
    createdAt: '2026-09-24T10:00:00.000Z',
    startedAt: '2026-09-24T10:00:01.000Z',
    completedAt: null,
    cancellable: true,
    log: [{ sequence: 1, message: 'start' }],
    result: { cities: 1 },
    controller,
    recordsSuccessfulUpdate: true,
  };

  const snapshot = adminTaskSnapshot(task);

  assert.equal(snapshot.id, 'task-1');
  assert.deepEqual(snapshot.result, { cities: 1 });
  assert.deepEqual(snapshot.actor, { userId: 7 });
  assert.equal('controller' in snapshot, false);
  assert.equal('recordsSuccessfulUpdate' in snapshot, false);

  snapshot.parameters.dryRun = false;
  assert.equal(task.parameters.dryRun, true);
});

test('admin task policy recognizes only active lifecycle states', () => {
  assert.equal(isAdminTaskActiveStatus('queued'), true);
  assert.equal(isAdminTaskActiveStatus('running'), true);
  assert.equal(isAdminTaskActiveStatus('cancelling'), true);
  assert.equal(isAdminTaskActiveStatus('succeeded'), false);
  assert.equal(isAdminTaskActiveStatus('failed'), false);
  assert.equal(isAdminTaskActiveStatus('cancelled'), false);
});

test('admin task cancellation policy preserves abort reason and elapsed time', () => {
  const controller = new AbortController();
  const reason = new AdminTaskCancelledError('stop');
  controller.abort(reason);

  assert.throws(
    () => throwIfAdminTaskCancelled(controller.signal),
    (error) => error === reason,
  );

  assert.equal(
    elapsedAdminTaskMilliseconds(
      '2026-09-24T10:00:00.000Z',
      '2026-09-24T10:00:02.500Z',
    ),
    2500,
  );
  assert.equal(
    elapsedAdminTaskMilliseconds('invalid', 'invalid'),
    null,
  );
});
