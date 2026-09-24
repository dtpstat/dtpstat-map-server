import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminTaskDerivedRefresh,
  createDerivedStateRefresh,
} from '../src/application/derived-state-refresh.js';

test('derived state refresh updates reports before public downloads with shared details', async () => {
  const calls = [];
  const operations = [];

  const derivedState =
    createDerivedStateRefresh({
      publicDownloadService: {
        directory:
          '/tmp/public-downloads',
        async refresh() {
          calls.push(
            'public-downloads',
          );
          return {
            files: 2,
          };
        },
      },
      reportConfigService: {
        async refresh() {
          calls.push(
            'city-report',
          );
          return {
            rows: 12,
          };
        },
      },
      async runOperation(
        event,
        operation,
        options,
      ) {
        operations.push({
          event,
          details:
            options.details,
        });
        return operation();
      },
    });

  const result =
    await derivedState.refreshAll({
      reason: 'test',
      taskId: 'task-1',
    });

  assert.deepEqual(
    calls,
    [
      'city-report',
      'public-downloads',
    ],
  );
  assert.deepEqual(
    operations,
    [
      {
        event:
          'city-report.refresh',
        details: {
          reason: 'test',
          taskId: 'task-1',
        },
      },
      {
        event:
          'public-downloads.refresh',
        details: {
          directory:
            '/tmp/public-downloads',
          reason: 'test',
          taskId: 'task-1',
        },
      },
    ],
  );
  assert.deepEqual(
    result,
    {
      files: 2,
    },
  );
});

test('admin task derived refresh filters task types and forwards task identity', async () => {
  const refreshes = [];
  const afterSuccessfulUpdate =
    createAdminTaskDerivedRefresh({
      async refreshAll(details) {
        refreshes.push(details);
        return {
          refreshed: true,
        };
      },
    });

  assert.equal(
    await afterSuccessfulUpdate({
      taskType:
        'unrelated-task',
      taskId: 'skip',
    }),
    undefined,
  );

  const result =
    await afterSuccessfulUpdate({
      taskType: 'kml-update',
      taskId: 'task-42',
    });

  assert.deepEqual(
    refreshes,
    [
      {
        reason:
          'admin-update',
        taskType:
          'kml-update',
        taskId:
          'task-42',
      },
    ],
  );
  assert.deepEqual(
    result,
    {
      refreshed: true,
    },
  );
});
