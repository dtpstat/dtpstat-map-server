import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOsmCheckpointRuntime,
} from '../src/application/osm-checkpoint-runtime.js';
import {
  createOsmCheckpointRecordRepository,
} from '../src/db/osm-checkpoint-record-repository.js';
import {
  createOsmCheckpointStageRepository,
} from '../src/db/osm-checkpoint-stage-repository.js';

function checkpointRow(id = '12') {
  return {
    id,
    status: 'downloading',
    sourceURL: 'https://overpass-api.de/api/interpreter',
    settingsFingerprint: 'settings',
    indexFingerprint: 'index',
    options: {},
    sourceElements: 3,
    duplicateIndexObjects: 0,
    osmTimestamp: null,
    downloadedBytes: '10',
    requestAttemptCount: 1,
    retryCount: 0,
    retryWaitMs: '0',
    throttleWaitMs: '0',
    ignoredElements: 0,
    stagedBatchCount: 0,
    totalObjects: 3,
    stagedObjects: 0,
    geometryObjects: 0,
    unbuildableGeometryObjects: 0,
    lastError: null,
    createdAt: '2026-09-24T10:00:00.000Z',
    updatedAt: '2026-09-24T10:00:00.000Z',
    completedAt: null,
  };
}

test('OSM checkpoint record repository owns metadata lifecycle and metrics SQL', async () => {
  const queries = [];
  const database = {
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });

      if (normalized.startsWith(
        'INSERT INTO osm_city_update_checkpoints',
      )) {
        return {
          rows: [{ id: '12' }],
          rowCount: 1,
        };
      }
      if (normalized.startsWith('SELECT') &&
          normalized.includes(
            'FROM osm_city_update_checkpoints AS checkpoint',
          )) {
        return {
          rows: [checkpointRow()],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const repository =
    createOsmCheckpointRecordRepository(database);

  const created = await repository.create({
    sourceURL: 'https://overpass-api.de/api/interpreter',
    settingsFingerprint: 'settings',
    indexFingerprint: 'index',
    options: {},
    indexObjects: [
      { osmType: 'relation', osmId: 1 },
      { osmType: 'way', osmId: 2 },
      { osmType: 'way', osmId: 3 },
    ],
    sourceElements: 3,
    duplicateIndexObjects: 0,
    osmTimestamp: null,
    downloadedBytes: 10,
    requestAttemptCount: 1,
    retryCount: 0,
    retryWaitMs: 0,
    throttleWaitMs: 0,
  });
  await repository.addMetrics(12, {
    downloadedBytes: 5,
    requestAttemptCount: 2,
    retryCount: 1,
    retryWaitMs: 10,
    throttleWaitMs: 20,
  });

  assert.equal(created.id, 12);
  assert.equal(created.remainingObjects, 3);
  assert.match(
    queries[0].text,
    /^INSERT INTO osm_city_update_checkpoints/u,
  );
  assert.match(
    queries[1].text,
    /LEFT JOIN osm_city_update_checkpoint_stage AS stage/u,
  );
  assert.match(
    queries[2].text,
    /^UPDATE osm_city_update_checkpoints/u,
  );
  assert.deepEqual(
    queries[2].values,
    [12, 5, 2, 1, 10, 20],
  );
});

test('OSM checkpoint stage repository owns PostGIS build validation and batch counts', async () => {
  const queries = [];
  const client = {
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });

      if (normalized.startsWith('WITH payload_rows AS')) {
        return {
          rows: [
            { geometryStatus: 'ready' },
            { geometryStatus: 'unbuildable' },
          ],
          rowCount: 2,
        };
      }
      if (normalized.startsWith('WITH identities AS')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
  const repository =
    createOsmCheckpointStageRepository({
      query: client.query.bind(client),
    });

  const result = await repository.stageBatch(
    client,
    12,
    [
      {
        name: 'City',
        placeType: 'city',
        osmType: 'relation',
        osmId: 1,
      },
      {
        name: 'Town',
        placeType: 'town',
        osmType: 'way',
        osmId: 2,
      },
    ],
  );

  assert.deepEqual(result, {
    batchGeometryObjects: 1,
    batchUnbuildableGeometryObjects: 1,
  });
  assert.match(
    queries[0].text,
    /ST_BuildArea/u,
  );
  assert.match(
    queries[0].text,
    /ON CONFLICT \(checkpoint_id, osm_type, osm_id\)/u,
  );
  assert.match(
    queries[1].text,
    /ST_Area\(stage\.geom::geography\) <= 0/u,
  );
});

test('OSM checkpoint runtime keeps resumable replacement atomic across record and stage storage', async () => {
  const events = [];
  const client = {
    async query(text) {
      events.push(text);
      return { rows: [], rowCount: 1 };
    },
    release() {
      events.push('release');
    },
  };
  const pool = {
    async connect() {
      events.push('connect');
      return client;
    },
    async query() {
      throw new Error('runtime should delegate SQL');
    },
  };
  const records = {
    async lockResumable(_client, checkpointId) {
      events.push(`lock:${checkpointId}`);
      return true;
    },
    async discardRecord(_client, checkpointId) {
      events.push(`discard-record:${checkpointId}`);
    },
    async insert(_client, value) {
      events.push(`insert:${value.indexFingerprint}`);
      return 22;
    },
    async getById(checkpointId) {
      events.push(`get:${checkpointId}`);
      return { id: checkpointId, status: 'downloading' };
    },
  };
  const stage = {
    async deleteByCheckpoint(_client, checkpointId) {
      events.push(`delete-stage:${checkpointId}`);
    },
  };
  const repository = createOsmCheckpointRuntime(
    pool,
    { records, stage },
  );

  const result = await repository.replaceResumable(
    12,
    { indexFingerprint: 'new-index' },
  );

  assert.equal(result.id, 22);
  assert.deepEqual(events, [
    'connect',
    'BEGIN',
    'lock:12',
    'discard-record:12',
    'insert:new-index',
    'delete-stage:12',
    'COMMIT',
    'release',
    'get:22',
  ]);
});

test('OSM checkpoint runtime completion uses the caller transaction for stage cleanup and status', async () => {
  const events = [];
  const client = {};
  const repository = createOsmCheckpointRuntime(
    {
      async query() {
        throw new Error('not expected');
      },
      async connect() {
        throw new Error('not expected');
      },
    },
    {
      records: {
        async completeRecord(received, checkpointId) {
          assert.equal(received, client);
          events.push(`complete:${checkpointId}`);
        },
      },
      stage: {
        async deleteByCheckpoint(received, checkpointId) {
          assert.equal(received, client);
          events.push(`delete:${checkpointId}`);
        },
      },
    },
  );

  await repository.complete(client, 12);

  assert.deepEqual(events, ['delete:12', 'complete:12']);
});
