import assert from 'node:assert/strict';
import test from 'node:test';
import { OsmCityDownloadError } from '../src/data/osm-city-downloader.js';
import {
  processOsmGeometryBatches,
} from '../src/modules/osm/update-geometry-session.js';

function place(osmType, osmId, name, placeType = 'city') {
  return {
    osmType,
    osmId,
    name,
    placeType,
    tags: { name, place: placeType },
    linework: {
      type: 'MultiLineString',
      coordinates: [[[30, 60], [31, 60], [30, 60]]],
    },
  };
}

const options = {
  batchSize: 2,
  queryTimeoutSeconds: 120,
  maxRetries: 6,
  maxResponseBytes: 1000000,
};

test('OSM geometry session splits oversized batches and stages both halves', async () => {
  const pendingObjects = [
    { osmType: 'relation', osmId: 1 },
    { osmType: 'way', osmId: 2 },
  ];
  const staged = [];
  const progress = [];
  let downloads = 0;
  const boundaryUpdateRepository = {
    async stageBatch(_client, places, batchNumber) {
      staged.push({
        batchNumber,
        keys: places.map((item) => `${item.osmType}/${item.osmId}`),
      });
    },
  };

  const result = await processOsmGeometryBatches({
    pendingObjects,
    options,
    indexedPlaces: 2,
    checkpoint: null,
    checkpointRepository: null,
    boundaryUpdateRepository,
    client: {},
    async downloadQuery(_query, metadata) {
      downloads += 1;
      if (downloads === 1) {
        throw new OsmCityDownloadError('too large', {
          code: 'response-size-limit',
          limitBytes: options.maxResponseBytes,
          receivedBytes: options.maxResponseBytes + 1,
        });
      }
      return {
        jsonText: metadata.batch === 1 ? 'left' : 'right',
      };
    },
    parseBatch(jsonText) {
      const parsedPlace = jsonText === 'left'
        ? place('relation', 1, 'Первый')
        : place('way', 2, 'Второй', 'town');
      return {
        places: [parsedPlace],
        cityPlaces: parsedPlace.placeType === 'city' ? 1 : 0,
        townPlaces: parsedPlace.placeType === 'town' ? 1 : 0,
        administrativePlaces: 0,
        ignoredElements: 0,
      };
    },
    metricDelta: () => ({}),
    rememberPersistedMetrics() {},
    emitProgress(value) {
      progress.push(value);
    },
  });

  assert.equal(downloads, 3);
  assert.deepEqual(staged, [
    { batchNumber: 1, keys: ['relation/1'] },
    { batchNumber: 2, keys: ['way/2'] },
  ]);
  assert.equal(result.batchCount, 2);
  assert.equal(result.stagedPlaces, 2);
  assert.equal(result.geometryPlaces, 2);
  assert.equal(result.cityPlaces, 1);
  assert.equal(result.townPlaces, 1);
  assert.deepEqual(progress.map((item) => item.phase), [
    'split',
    'geometry',
    'geometry',
  ]);
  assert.deepEqual(progress[0].splitSizes, [1, 1]);
});

test('OSM geometry session fails one oversized object with exact OSM identity', async () => {
  await assert.rejects(
    processOsmGeometryBatches({
      pendingObjects: [{ osmType: 'relation', osmId: 77 }],
      options: { ...options, batchSize: 1 },
      indexedPlaces: 1,
      checkpoint: null,
      checkpointRepository: null,
      boundaryUpdateRepository: {
        async stageBatch() {
          throw new Error('must not stage');
        },
      },
      client: {},
      async downloadQuery() {
        throw new OsmCityDownloadError('too large', {
          code: 'response-size-limit',
          limitBytes: 100,
          receivedBytes: 101,
        });
      },
      parseBatch() {
        throw new Error('must not parse');
      },
      metricDelta: () => ({}),
      rememberPersistedMetrics() {},
    }),
    (error) => {
      assert.ok(error instanceof OsmCityDownloadError);
      assert.equal(error.code, 'response-size-limit');
      assert.match(error.message, /relation\/77/u);
      return true;
    },
  );
});

test('OSM geometry session converts exhausted geometry 504 into one-object failure', async () => {
  await assert.rejects(
    processOsmGeometryBatches({
      pendingObjects: [{ osmType: 'way', osmId: 99 }],
      options: { ...options, batchSize: 1, maxRetries: 4 },
      indexedPlaces: 1,
      checkpoint: null,
      checkpointRepository: null,
      boundaryUpdateRepository: {
        async stageBatch() {
          throw new Error('must not stage');
        },
      },
      client: {},
      async downloadQuery() {
        const error = new OsmCityDownloadError('gateway timeout', {
          code: 'geometry-504-retry-limit',
          statusCode: 504,
        });
        error.retryCount = 3;
        throw error;
      },
      parseBatch() {
        throw new Error('must not parse');
      },
      metricDelta: () => ({}),
      rememberPersistedMetrics() {},
    }),
    (error) => {
      assert.ok(error instanceof OsmCityDownloadError);
      assert.equal(error.code, 'retry-limit');
      assert.equal(error.statusCode, 504);
      assert.match(error.message, /way\/99/u);
      return true;
    },
  );
});

test('OSM geometry session stages checkpoint batches with checksums and metrics', async () => {
  const stagedCalls = [];
  let remembered = 0;
  const checkpointRepository = {
    async stageBatch(id, places, metrics) {
      stagedCalls.push({ id, places, metrics });
      return {
        id,
        geometryObjects: 1,
        unbuildableGeometryObjects: 1,
        batchUnbuildableGeometryObjects: 1,
      };
    },
  };
  const parsedPlaces = [
    place('relation', 1, 'Первый'),
    place('way', 2, 'Второй', 'town'),
  ];

  const result = await processOsmGeometryBatches({
    pendingObjects: [
      { osmType: 'relation', osmId: 1 },
      { osmType: 'way', osmId: 2 },
    ],
    options,
    indexedPlaces: 2,
    checkpoint: { id: 5 },
    checkpointRepository,
    boundaryUpdateRepository: null,
    client: {},
    async downloadQuery() {
      return { jsonText: 'batch' };
    },
    parseBatch() {
      return {
        places: parsedPlaces,
        cityPlaces: 1,
        townPlaces: 1,
        administrativePlaces: 0,
        ignoredElements: 2,
      };
    },
    metricDelta() {
      return {
        downloadedBytes: 50,
        requestAttemptCount: 1,
        retryCount: 0,
        retryWaitMs: 0,
        throttleWaitMs: 0,
      };
    },
    rememberPersistedMetrics() {
      remembered += 1;
    },
    initialStagedPlaces: 0,
    initialGeometryPlaces: 0,
    initialUnbuildableGeometryPlaces: 0,
    initialIgnoredElements: 3,
  });

  assert.equal(stagedCalls.length, 1);
  assert.equal(stagedCalls[0].id, 5);
  assert.equal(stagedCalls[0].places.length, 2);
  for (const item of stagedCalls[0].places) {
    assert.equal(typeof item.contentChecksum, 'string');
    assert.equal(item.contentChecksum.length, 64);
  }
  assert.equal(stagedCalls[0].metrics.downloadedBytes, 50);
  assert.equal(stagedCalls[0].metrics.ignoredElements, 2);
  assert.equal(remembered, 1);
  assert.equal(result.checkpoint.id, 5);
  assert.equal(result.stagedPlaces, 2);
  assert.equal(result.geometryPlaces, 1);
  assert.equal(result.unbuildableGeometryPlaces, 1);
  assert.equal(result.ignoredElements, 5);
});
