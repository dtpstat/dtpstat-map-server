import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminTaskSuccessRepository } from '../src/db/admin-task-success-repository.js';

test('admin task success repository loads and upserts persistent timestamps', async () => {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (values === undefined) {
        return {
          rows: [{
            taskType: 'osm-city-update',
            taskId: null,
            endpoint: '/api/admin/update/cities',
            completedAt: new Date('2026-08-31T12:00:00.000Z'),
          }],
        };
      }
      return {
        rows: [{
          taskType: values[0],
          taskId: values[1],
          endpoint: values[2],
          completedAt: new Date(values[3]),
        }],
      };
    },
  };
  const repository = createAdminTaskSuccessRepository(pool);

  assert.deepEqual(await repository.list(), [{
    taskType: 'osm-city-update',
    taskId: null,
    endpoint: '/api/admin/update/cities',
    completedAt: '2026-08-31T12:00:00.000Z',
  }]);

  const update = {
    taskType: 'kml-update',
    taskId: '31f0e2c5-2fd1-4c57-a82a-891571187905',
    endpoint: '/api/admin/update',
    completedAt: '2026-09-01T10:00:00.000Z',
  };
  assert.deepEqual(await repository.record(update), update);
  assert.match(calls[1].text, /ON CONFLICT \(task_type\) DO UPDATE/);
  assert.deepEqual(calls[1].values, Object.values(update));
});
