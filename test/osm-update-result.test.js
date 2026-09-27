import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOsmUpdateResult,
  buildOsmUpdateRunValues,
  finalizeOsmUpdateResult,
} from '../src/modules/osm/update-result.js';

const options = {
  dryRun: false,
  url: 'https://overpass-api.de/api/interpreter',
  batchSize: 25,
  maxResponseBytes: 1000000,
  maxTotalBytes: 2000000,
  minDelayMs: 5000,
  maxRetries: 6,
};

const index = {
  sourceElements: 10,
  objects: [
    { osmType: 'relation', osmId: 1 },
    { osmType: 'way', osmId: 2 },
  ],
  duplicateIndexObjects: 1,
  osmTimestamp: '2026-09-23T10:00:00.000Z',
};

const requestMetrics = {
  downloadedBytes: 500,
  requestAttemptCount: 7,
  retryCount: 1,
  retryWaitMs: 30000,
  throttleWaitMs: 5000,
};

test('OSM result builder preserves update-run storage order', () => {
  assert.deepEqual(buildOsmUpdateRunValues({
    options,
    checksum: 'sum',
    requestMetrics,
    index,
    geometryPlaces: 2,
    ignoredElements: 3,
    cityPlaces: 1,
    townPlaces: 1,
    duplicateNames: 0,
    administrativePlaces: 1,
    batchCount: 2,
  }), [
    options.url,
    'sum',
    500,
    10,
    2,
    3,
    index.osmTimestamp,
    1,
    1,
    0,
    1,
    1,
    25,
    2,
  ]);
});

test('OSM result builder keeps public result shape and commit finalization', () => {
  const result = buildOsmUpdateResult({
    options,
    indexQueries: [1, 2, 3, 4],
    indexFinalURLs: new Set([options.url]),
    requestMetrics,
    index,
    geometryPlaces: 2,
    unbuildableGeometryPlaces: 1,
    cityPlaces: 1,
    townPlaces: 1,
    administrativePlaces: 1,
    duplicateNames: 0,
    ignoredElements: 3,
    batchCount: 2,
    restoredGeometryLinks: 4,
    checksum: 'sum',
    checkpoint: { id: 9 },
    mode: { resume: true },
    reusedObjects: 1,
  });

  assert.equal(result.indexRequestCount, 4);
  assert.equal(result.downloadedBytes, 500);
  assert.equal(result.importedPlaces, 2);
  assert.equal(result.unbuildableGeometryPlaces, 1);
  assert.equal(result.restoredGeometryLinks, 4);
  assert.equal(result.checkpointId, 9);
  assert.equal(result.resumed, true);
  assert.equal(result.reusedObjects, 1);

  assert.deepEqual(finalizeOsmUpdateResult({
    result,
    commitResult: {
      committed: true,
      run: {
        id: 12,
        createdAt: '2026-09-23T12:00:00.000Z',
      },
    },
    checkpointEnabled: true,
  }), {
    ...result,
    checkpointStatus: 'completed',
    resumable: false,
    updateRunId: 12,
    completedAt: '2026-09-23T12:00:00.000Z',
  });

  assert.deepEqual(finalizeOsmUpdateResult({
    result,
    commitResult: { committed: false, run: null },
    checkpointEnabled: true,
  }), {
    ...result,
    checkpointStatus: 'ready',
    resumable: true,
  });
});
