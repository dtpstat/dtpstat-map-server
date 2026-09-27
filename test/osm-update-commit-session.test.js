import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitOsmBoundaryUpdate,
} from '../src/modules/osm/update-commit-session.js';

function createClient() {
  const queries = [];
  return {
    queries,
    async query(text) {
      queries.push(text.trim());
      return { rows: [], rowCount: 0 };
    },
  };
}

function createBoundaryRepository({
  inserted = 2,
  restored = 3,
  run = { id: 9, createdAt: '2026-09-23T12:00:00.000Z' },
} = {}) {
  const calls = [];
  return {
    calls,
    async preserveLinks() { calls.push('preserveLinks'); },
    async deleteBoundaries() { calls.push('deleteBoundaries'); },
    async insertBoundaries(_client, timestamp) {
      calls.push(['insertBoundaries', timestamp]);
      return { rowCount: inserted };
    },
    async activateNewPlaces() { calls.push('activateNewPlaces'); },
    async restoreGeometryLinks() {
      calls.push('restoreGeometryLinks');
      return { rowCount: restored };
    },
    async insertRun(_client, values) {
      calls.push(['insertRun', values]);
      return { rows: [run], rowCount: 1 };
    },
  };
}

test('OSM commit session keeps replacement order inside one transaction', async () => {
  const client = createClient();
  const repository = createBoundaryRepository();
  const events = [];
  const checkpointRepository = {
    async complete(completeClient, id) {
      assert.equal(completeClient, client);
      events.push(['checkpointComplete', id]);
    },
  };

  const result = await commitOsmBoundaryUpdate({
    client,
    pool: { databaseSchema: 'buslanes' },
    boundaryUpdateRepository: repository,
    checkpointRepository,
    checkpoint: { id: 7 },
    osmTimestamp: '2026-09-23T10:00:00.000Z',
    geometryPlaces: 2,
    dryRun: false,
    runValues: ['run-values'],
    async acquireLock(lockClient) {
      assert.equal(lockClient, client);
      events.push('lock');
    },
    async rebuildHierarchy(hierarchyClient, { onProgress }) {
      assert.equal(hierarchyClient, client);
      events.push('hierarchy');
      onProgress({ phase: 'hierarchy', processed: 2, total: 2 });
    },
    async syncDerivedData(syncClient) {
      assert.equal(syncClient, client);
      events.push('sync');
    },
    assertNotCancelled() {
      events.push('cancel-check');
    },
    emitProgress(progress) {
      events.push(['progress', progress.phase]);
    },
    onCommit() {
      events.push('onCommit');
    },
  });

  assert.equal(result.committed, true);
  assert.equal(result.restoredGeometryLinks, 3);
  assert.deepEqual(result.run, {
    id: 9,
    createdAt: '2026-09-23T12:00:00.000Z',
  });
  assert.deepEqual(client.queries, ['BEGIN', 'COMMIT']);
  assert.deepEqual(repository.calls, [
    'preserveLinks',
    'deleteBoundaries',
    ['insertBoundaries', '2026-09-23T10:00:00.000Z'],
    'activateNewPlaces',
    'restoreGeometryLinks',
    ['insertRun', ['run-values']],
  ]);
  assert.ok(events.some((item) =>
    Array.isArray(item) &&
    item[0] === 'checkpointComplete' &&
    item[1] === 7));
  assert.ok(events.includes('onCommit'));
});

test('OSM commit session dry run rolls back and does not finalize checkpoint', async () => {
  const client = createClient();
  const repository = createBoundaryRepository();
  let completed = false;

  const result = await commitOsmBoundaryUpdate({
    client,
    pool: {},
    boundaryUpdateRepository: repository,
    checkpointRepository: {
      async complete() {
        completed = true;
      },
    },
    checkpoint: { id: 7 },
    osmTimestamp: null,
    geometryPlaces: 2,
    dryRun: true,
    runValues: ['unused'],
    async acquireLock() {},
    async rebuildHierarchy() {},
    async syncDerivedData() {},
  });

  assert.equal(result.committed, false);
  assert.equal(result.run, null);
  assert.equal(completed, false);
  assert.deepEqual(client.queries, ['BEGIN', 'ROLLBACK']);
  assert.ok(!repository.calls.some((item) =>
    Array.isArray(item) && item[0] === 'insertRun'));
});

test('OSM commit session rolls back replacement failures', async () => {
  const client = createClient();
  const repository = createBoundaryRepository({ inserted: 1 });

  await assert.rejects(
    commitOsmBoundaryUpdate({
      client,
      pool: {},
      boundaryUpdateRepository: repository,
      checkpointRepository: null,
      checkpoint: null,
      osmTimestamp: null,
      geometryPlaces: 2,
      dryRun: false,
      runValues: [],
      async acquireLock() {},
      async rebuildHierarchy() {
        throw new Error('must not reach hierarchy');
      },
      async syncDerivedData() {},
    }),
    /Not every buildable OSM boundary was inserted/u,
  );

  assert.deepEqual(client.queries, ['BEGIN', 'ROLLBACK']);
});
