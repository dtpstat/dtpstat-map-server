import assert from 'node:assert/strict';
import test from 'node:test';
import { OsmCityUpdateValidationError } from '../src/data/osm-city-update-options.js';
import {
  materializeReadyOsmCheckpoint,
  persistOsmCheckpointFailure,
  prepareOsmCheckpoint,
  preparePendingOsmGeometry,
} from '../src/modules/osm/update-checkpoint-session.js';

test('OSM checkpoint session validates resume compatibility and unfinished state', async () => {
  const compatible = {
    id: 5,
    settingsFingerprint: 'same',
    stagedObjects: 2,
    totalObjects: 3,
  };
  const repository = {
    async cleanup() {},
    async getResumable() {
      return compatible;
    },
  };

  assert.equal(
    await prepareOsmCheckpoint({
      checkpointRepository: repository,
      mode: { resume: true, restart: false },
      settingsFingerprint: 'same',
    }),
    compatible,
  );

  await assert.rejects(
    prepareOsmCheckpoint({
      checkpointRepository: repository,
      mode: { resume: true, restart: false },
      settingsFingerprint: 'different',
    }),
    OsmCityUpdateValidationError,
  );

  await assert.rejects(
    prepareOsmCheckpoint({
      checkpointRepository: repository,
      mode: { resume: false, restart: false },
      settingsFingerprint: 'same',
    }),
    /resume it or explicitly start over/u,
  );
});

test('OSM checkpoint session derives pending objects and resume progress', async () => {
  const progress = [];
  const checkpoint = {
    id: 5,
    status: 'failed',
    geometryObjects: 1,
    unbuildableGeometryObjects: 1,
  };
  const index = {
    objects: [
      { osmType: 'relation', osmId: 1 },
      { osmType: 'way', osmId: 2 },
      { osmType: 'way', osmId: 3 },
    ],
  };
  const state = await preparePendingOsmGeometry({
    checkpointRepository: {
      async getStagedKeys() {
        return new Set(['relation/1', 'way/2']);
      },
    },
    checkpoint,
    index,
    mode: { resume: true, restart: false },
    emitProgress(value) {
      progress.push(value);
    },
  });

  assert.equal(state.stagedPlaces, 2);
  assert.equal(state.geometryPlaces, 1);
  assert.equal(state.unbuildableGeometryPlaces, 1);
  assert.deepEqual(state.pendingObjects, [{ osmType: 'way', osmId: 3 }]);
  assert.deepEqual(progress, [{
    phase: 'resume',
    checkpointId: 5,
    checkpointStatus: 'failed',
    stagedPlaces: 2,
    geometryPlaces: 1,
    unbuildableGeometryPlaces: 1,
    indexedPlaces: 3,
    remainingPlaces: 1,
  }]);
});

test('OSM checkpoint session materializes ready stage and derives statistics', async () => {
  const calls = [];
  const checkpointRepository = {
    async getById() {
      return {
        id: 7,
        stagedObjects: 2,
        ignoredElements: 4,
        stagedBatchCount: 3,
        indexFingerprint: 'index',
      };
    },
    async mark(id, status) {
      calls.push(['mark', id, status]);
      return {
        id,
        stagedObjects: 2,
        ignoredElements: 4,
        stagedBatchCount: 3,
        indexFingerprint: 'index',
      };
    },
    async stats() {
      return {
        geometryObjects: 1,
        unbuildableGeometryObjects: 1,
        cityPlaces: 1,
        townPlaces: 0,
        administrativePlaces: 1,
        duplicateNames: 0,
      };
    },
    async checksums() {
      return [{
        osmType: 'relation',
        osmId: '1',
        contentChecksum: 'a',
      }];
    },
  };
  const boundaryUpdateRepository = {
    async dropStage() {
      calls.push('dropStage');
    },
    async materializeCheckpointStage(_client, id) {
      calls.push(['materialize', id]);
    },
  };

  const result = await materializeReadyOsmCheckpoint({
    checkpointRepository,
    boundaryUpdateRepository,
    client: {},
    checkpoint: { id: 7 },
    index: {
      objects: [
        { osmType: 'relation', osmId: 1 },
        { osmType: 'way', osmId: 2 },
      ],
    },
  });

  assert.equal(result.geometryPlaces, 1);
  assert.equal(result.unbuildableGeometryPlaces, 1);
  assert.equal(result.ignoredElements, 4);
  assert.equal(result.batchCount, 3);
  assert.equal(typeof result.checksum, 'string');
  assert.deepEqual(calls, [
    ['mark', 7, 'ready'],
    'dropStage',
    ['materialize', 7],
  ]);
});

test('OSM checkpoint failure session persists metric delta before status', async () => {
  const calls = [];
  let remembered = 0;
  await persistOsmCheckpointFailure({
    checkpointRepository: {
      async addMetrics(id, delta) {
        calls.push(['metrics', id, delta]);
      },
      async mark(id, status, details) {
        calls.push(['mark', id, status, details.code]);
      },
    },
    checkpoint: { id: 9 },
    metricDelta() {
      return {
        downloadedBytes: 10,
        requestAttemptCount: 1,
        retryCount: 0,
        retryWaitMs: 0,
        throttleWaitMs: 0,
      };
    },
    rememberPersistedMetrics() {
      remembered += 1;
    },
    error: Object.assign(new Error('failed'), { code: 'network-error' }),
    cancelled: false,
  });

  assert.equal(remembered, 1);
  assert.deepEqual(calls, [
    ['metrics', 9, {
      downloadedBytes: 10,
      requestAttemptCount: 1,
      retryCount: 0,
      retryWaitMs: 0,
      throttleWaitMs: 0,
    }],
    ['mark', 9, 'failed', 'network-error'],
  ]);
});
