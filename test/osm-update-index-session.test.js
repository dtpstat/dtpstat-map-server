import assert from 'node:assert/strict';
import test from 'node:test';
import { OsmCityUpdateValidationError } from '../src/modules/osm/osm-city-update-options.js';
import { checkpointIndexFingerprint } from '../src/modules/osm/update-checkpoint-policy.js';
import { loadOsmUpdateIndex } from '../src/modules/osm/update-index-session.js';

const options = {
  url: 'https://overpass-api.de/api/interpreter',
  includeCity: true,
  includeTown: true,
  includeAdministrative: false,
  adminLevelMin: 4,
  adminLevelMax: 8,
  queryTimeoutSeconds: 120,
  batchSize: 25,
};

const requestMetrics = {
  downloadedBytes: 400,
  requestAttemptCount: 4,
  retryCount: 1,
  retryWaitMs: 30000,
  throttleWaitMs: 1000,
};

test('OSM index session downloads, combines and checkpoints a fresh index', async () => {
  const progress = [];
  const downloaded = [];
  const parsedParts = [
    {
      objects: [{ osmType: 'way', osmId: 2 }],
      sourceElements: 1,
      osmTimestamp: '2026-09-23T12:00:00.000Z',
    },
    {
      objects: [{ osmType: 'relation', osmId: 1 }],
      sourceElements: 1,
      osmTimestamp: '2026-09-23T11:00:00.000Z',
    },
    {
      objects: [{ osmType: 'way', osmId: 3 }],
      sourceElements: 1,
      osmTimestamp: '2026-09-23T12:00:00.000Z',
    },
    {
      objects: [],
      sourceElements: 0,
      osmTimestamp: '2026-09-23T12:00:00.000Z',
    },
  ];
  let parseCall = 0;
  let created;
  const checkpointRepository = {
    async create(value) {
      created = structuredClone(value);
      return {
        id: 7,
        status: 'downloading',
        ...structuredClone(value),
      };
    },
  };

  const result = await loadOsmUpdateIndex({
    options,
    mode: { resume: false, restart: false },
    checkpoint: null,
    checkpointRepository,
    settingsFingerprint: 'settings',
    requestMetrics,
    async downloadQuery(query, requestProgress) {
      downloaded.push({ query, requestProgress });
      return {
        jsonText: `part-${downloaded.length}`,
        finalURL: options.url,
      };
    },
    parseIndex() {
      const part = parsedParts[parseCall];
      parseCall += 1;
      return part;
    },
    emitProgress(value) {
      progress.push(value);
    },
  });

  assert.equal(result.indexQueries.length, 4);
  assert.equal(downloaded.length, 4);
  assert.deepEqual(result.index.objects, [
    { osmType: 'relation', osmId: 1 },
    { osmType: 'way', osmId: 2 },
    { osmType: 'way', osmId: 3 },
  ]);
  assert.equal(result.index.sourceElements, 3);
  assert.equal(result.index.osmTimestamp, '2026-09-23T11:00:00.000Z');
  assert.equal(result.checkpoint.id, 7);
  assert.equal(result.checkpointPersisted, true);
  assert.equal(created.settingsFingerprint, 'settings');
  assert.deepEqual(created.indexObjects, result.index.objects);
  assert.equal(created.downloadedBytes, 400);
  assert.deepEqual(
    progress.map((item) => item.indexedPlaces),
    [1, 2, 3, 3],
  );
});

test('OSM index session reuses and verifies a resumable checkpoint index', async () => {
  const objects = [
    { osmType: 'relation', osmId: 10 },
    { osmType: 'way', osmId: 20 },
  ];
  const checkpoint = {
    id: 5,
    sourceURL: options.url,
    sourceElements: 2,
    duplicateIndexObjects: 0,
    osmTimestamp: '2026-09-23T10:00:00.000Z',
    indexFingerprint: checkpointIndexFingerprint(objects),
  };
  let downloads = 0;
  const result = await loadOsmUpdateIndex({
    options,
    mode: { resume: true, restart: false },
    checkpoint,
    checkpointRepository: {
      async getIndexObjects(id) {
        assert.equal(id, 5);
        return structuredClone(objects);
      },
    },
    settingsFingerprint: 'unused',
    requestMetrics,
    async downloadQuery() {
      downloads += 1;
      throw new Error('must not download');
    },
    parseIndex() {
      throw new Error('must not parse');
    },
  });

  assert.equal(downloads, 0);
  assert.deepEqual(result.index.objects, objects);
  assert.equal(result.checkpoint, checkpoint);
  assert.equal(result.checkpointPersisted, false);
});

test('OSM index session rejects a corrupted reusable index fingerprint', async () => {
  const checkpoint = {
    id: 5,
    sourceURL: options.url,
    sourceElements: 1,
    duplicateIndexObjects: 0,
    osmTimestamp: null,
    indexFingerprint: 'wrong',
  };

  await assert.rejects(
    loadOsmUpdateIndex({
      options,
      mode: { resume: true, restart: false },
      checkpoint,
      checkpointRepository: {
        async getIndexObjects() {
          return [{ osmType: 'relation', osmId: 10 }];
        },
      },
      settingsFingerprint: 'unused',
      requestMetrics,
      async downloadQuery() {
        throw new Error('must not download');
      },
      parseIndex() {
        throw new Error('must not parse');
      },
    }),
    /fingerprint does not match/u,
  );
});

test('OSM index session rejects objects of the wrong Overpass query type', async () => {
  await assert.rejects(
    loadOsmUpdateIndex({
      options: {
        ...options,
        includeTown: false,
      },
      mode: { resume: false, restart: false },
      checkpoint: null,
      checkpointRepository: null,
      settingsFingerprint: 'settings',
      requestMetrics,
      async downloadQuery() {
        return {
          jsonText: 'wrong-type',
          finalURL: options.url,
        };
      },
      parseIndex() {
        return {
          objects: [{ osmType: 'node', osmId: 1 }],
          sourceElements: 1,
          osmTimestamp: null,
        };
      },
    }),
    OsmCityUpdateValidationError,
  );
});
