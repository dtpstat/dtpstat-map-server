import assert from 'node:assert/strict';
import test from 'node:test';
import { OsmCityDownloadError } from '../src/data/osm-city-downloader.js';
import { createOsmCityUpdateService } from '../src/db/osm-city-update-service.js';

const config = {
  url: 'https://overpass-api.de/api/interpreter',
  allowedHosts: new Set(['overpass-api.de']),
  dryRun: false,
  timeoutMs: 180000,
  queryTimeoutSeconds: 120,
  maxResponseBytes: 1000000,
  maxTotalBytes: 2000000,
  maxBytes: 2000000,
  batchSize: 2,
  maxBatchSize: 10,
  minDelayMs: 0,
  maxRetries: 6,
  retryBaseDelayMs: 30000,
  retryMaxDelayMs: 240000,
  userAgent: 'dtpstat-buslines/2.0 test',
};

const index = {
  objects: [
    { osmType: 'relation', osmId: 7 },
    { osmType: 'way', osmId: 8 },
    { osmType: 'way', osmId: 9 },
  ],
  sourceElements: 3,
  osmTimestamp: '2026-08-31T12:00:00.000Z',
};

const indexParts = [
  { objects: [], sourceElements: 0, osmTimestamp: index.osmTimestamp },
  {
    objects: [{ osmType: 'relation', osmId: 7 }],
    sourceElements: 1,
    osmTimestamp: index.osmTimestamp,
  },
  {
    objects: [
      { osmType: 'way', osmId: 8 },
      { osmType: 'way', osmId: 9 },
    ],
    sourceElements: 2,
    osmTimestamp: index.osmTimestamp,
  },
  { objects: [], sourceElements: 0, osmTimestamp: index.osmTimestamp },
];

function place(osmType, osmId, name, placeType) {
  return {
    name,
    placeType,
    osmType,
    osmId,
    tags: { name, place: placeType },
    linework: {
      type: 'MultiLineString',
      coordinates: [[[30, 60], [31, 60], [30, 60]]],
    },
  };
}

const batches = [
  {
    places: [
      place('relation', 7, 'Тестоград', 'city'),
      place('way', 8, 'Дубль', 'town'),
    ],
    sourceElements: 2,
    ignoredElements: 0,
    cityPlaces: 1,
    townPlaces: 1,
    duplicateNames: 0,
    osmTimestamp: index.osmTimestamp,
  },
  {
    places: [place('way', 9, 'Дубль', 'town')],
    sourceElements: 1,
    ignoredElements: 0,
    cityPlaces: 0,
    townPlaces: 1,
    duplicateNames: 0,
    osmTimestamp: index.osmTimestamp,
  },
];

function createPool({ stageCount = 3, boundaryCount = 3 } = {}) {
  const queries = [];
  let released = false;
  let connections = 0;
  const client = {
    async query(text, parameters) {
      const normalized = text.trim();
      queries.push(normalized);
      if (normalized.startsWith('WITH payload_rows AS')) {
        return { rows: [], rowCount: JSON.parse(parameters[0]).length };
      }
      if (normalized.startsWith('SELECT name')) {
        return { rows: [], rowCount: 0 };
      }
      if (
        normalized.startsWith('SELECT count(*)::integer AS count') &&
        normalized.includes('FROM city_boundaries')
      ) {
        return { rows: [{ count: boundaryCount }], rowCount: 1 };
      }
      if (
        normalized.startsWith('WITH batch AS') &&
        normalized.includes('UPDATE city_boundaries AS child') &&
        normalized.includes('max(id)::text AS "lastId"')
      ) {
        const afterId = Number(parameters[0]);
        const batchSize = Number(parameters[1]);
        const count = Math.max(
          0,
          Math.min(batchSize, boundaryCount - afterId),
        );
        return {
          rows: [{
            count,
            lastId: count > 0 ? String(afterId + count) : null,
          }],
          rowCount: 1,
        };
      }
      if (normalized.startsWith('SELECT count(*)::integer')) {
        return { rows: [{ count: stageCount }], rowCount: 1 };
      }
      if (normalized.startsWith('INSERT INTO city_boundaries')) {
        return { rows: [], rowCount: boundaryCount };
      }
      if (normalized.startsWith('UPDATE city_geometries')) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith('INSERT INTO osm_city_update_runs')) {
        return {
          rows: [{ id: 9, createdAt: '2026-08-31T12:30:00.000Z' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };
  return {
    queries,
    get released() {
      return released;
    },
    get connections() {
      return connections;
    },
    async connect() {
      connections += 1;
      return client;
    },
  };
}

function createCheckpointRepositoryMock({
  unbuildableKeys = new Set(),
} = {}) {
  let checkpoint = null;
  let nextId = 1;
  const staged = new Map();
  const calls = [];

  const snapshot = () => {
    if (!checkpoint) return null;
    const values = [...staged.values()];
    const geometryObjects = values.filter(
      (item) => item.geometryStatus !== 'unbuildable',
    ).length;
    const unbuildableGeometryObjects =
      values.length - geometryObjects;
    return {
      ...structuredClone(checkpoint),
      stagedObjects: staged.size,
      geometryObjects,
      unbuildableGeometryObjects,
      remainingObjects: Math.max(
        0,
        checkpoint.totalObjects - staged.size,
      ),
    };
  };

  return {
    calls,
    staged,
    get state() {
      return snapshot();
    },
    async cleanup() {
      calls.push({ method: 'cleanup' });
      return 0;
    },
    async getResumable() {
      calls.push({ method: 'getResumable' });
      return snapshot();
    },
    async getById(id) {
      calls.push({ method: 'getById', id });
      return checkpoint?.id === id ? snapshot() : null;
    },
    async getIndexObjects(id) {
      calls.push({ method: 'getIndexObjects', id });
      return checkpoint?.id === id
        ? structuredClone(checkpoint.indexObjects)
        : null;
    },
    async create(value) {
      calls.push({ method: 'create' });
      checkpoint = {
        id: nextId,
        status: 'downloading',
        sourceURL: value.sourceURL,
        settingsFingerprint: value.settingsFingerprint,
        indexFingerprint: value.indexFingerprint,
        options: structuredClone(value.options),
        indexObjects: structuredClone(value.indexObjects),
        sourceElements: value.sourceElements,
        duplicateIndexObjects: value.duplicateIndexObjects,
        osmTimestamp: value.osmTimestamp,
        downloadedBytes: value.downloadedBytes,
        requestAttemptCount: value.requestAttemptCount,
        retryCount: value.retryCount,
        retryWaitMs: value.retryWaitMs,
        throttleWaitMs: value.throttleWaitMs,
        ignoredElements: 0,
        stagedBatchCount: 0,
        totalObjects: value.indexObjects.length,
        lastError: null,
        createdAt: '2026-09-20T10:00:00.000Z',
        updatedAt: '2026-09-20T10:00:00.000Z',
        completedAt: null,
      };
      nextId += 1;
      staged.clear();
      return snapshot();
    },
    async getStagedKeys(id) {
      calls.push({ method: 'getStagedKeys', id });
      return new Set(staged.keys());
    },
    async stageBatch(id, places, metrics) {
      calls.push({
        method: 'stageBatch',
        id,
        keys: places.map((item) => `${item.osmType}/${item.osmId}`),
      });
      let batchUnbuildableGeometryObjects = 0;
      for (const item of places) {
        const key = `${item.osmType}/${item.osmId}`;
        const geometryStatus = unbuildableKeys.has(key)
          ? 'unbuildable'
          : 'ready';
        if (geometryStatus === 'unbuildable') {
          batchUnbuildableGeometryObjects += 1;
        }
        staged.set(key, {
          ...structuredClone(item),
          geometryStatus,
        });
      }
      checkpoint.status = 'downloading';
      checkpoint.downloadedBytes += metrics.downloadedBytes ?? 0;
      checkpoint.requestAttemptCount += metrics.requestAttemptCount ?? 0;
      checkpoint.retryCount += metrics.retryCount ?? 0;
      checkpoint.retryWaitMs += metrics.retryWaitMs ?? 0;
      checkpoint.throttleWaitMs += metrics.throttleWaitMs ?? 0;
      checkpoint.ignoredElements += metrics.ignoredElements ?? 0;
      checkpoint.stagedBatchCount += 1;
      checkpoint.lastError = null;
      return {
        ...snapshot(),
        batchGeometryObjects:
          places.length - batchUnbuildableGeometryObjects,
        batchUnbuildableGeometryObjects,
      };
    },
    async addMetrics(id, metrics) {
      calls.push({ method: 'addMetrics', id });
      checkpoint.downloadedBytes += metrics.downloadedBytes ?? 0;
      checkpoint.requestAttemptCount += metrics.requestAttemptCount ?? 0;
      checkpoint.retryCount += metrics.retryCount ?? 0;
      checkpoint.retryWaitMs += metrics.retryWaitMs ?? 0;
      checkpoint.throttleWaitMs += metrics.throttleWaitMs ?? 0;
    },
    async mark(id, status, lastError = null) {
      calls.push({ method: 'mark', id, status });
      checkpoint.status = status;
      checkpoint.lastError = lastError;
      checkpoint.updatedAt = '2026-09-20T11:00:00.000Z';
      return snapshot();
    },
    async complete(client, id) {
      calls.push({ method: 'complete', id });
      await client.query(
        'DELETE FROM osm_city_update_checkpoint_stage WHERE checkpoint_id = $1',
        [id],
      );
      await client.query(
        `UPDATE osm_city_update_checkpoints
         SET status = 'completed',
             index_objects = '[]'::jsonb,
             last_error = NULL,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [id],
      );
      checkpoint.status = 'completed';
      checkpoint.indexObjects = [];
      checkpoint.totalObjects = 0;
      checkpoint.lastError = null;
      checkpoint.completedAt = '2026-09-20T13:00:00.000Z';
      checkpoint.updatedAt = checkpoint.completedAt;
      staged.clear();
    },
    async discard(id) {
      calls.push({ method: 'discard', id });
      checkpoint.status = 'discarded';
      checkpoint.indexObjects = [];
      checkpoint.totalObjects = 0;
      staged.clear();
    },
    async replaceResumable(id, value) {
      calls.push({ method: 'replaceResumable', id });
      if (checkpoint?.id !== id) {
        throw new Error('checkpoint no longer resumable');
      }
      checkpoint = {
        id: nextId,
        status: 'downloading',
        sourceURL: value.sourceURL,
        settingsFingerprint: value.settingsFingerprint,
        indexFingerprint: value.indexFingerprint,
        options: structuredClone(value.options),
        indexObjects: structuredClone(value.indexObjects),
        sourceElements: value.sourceElements,
        duplicateIndexObjects: value.duplicateIndexObjects,
        osmTimestamp: value.osmTimestamp,
        downloadedBytes: value.downloadedBytes,
        requestAttemptCount: value.requestAttemptCount,
        retryCount: value.retryCount,
        retryWaitMs: value.retryWaitMs,
        throttleWaitMs: value.throttleWaitMs,
        ignoredElements: 0,
        stagedBatchCount: 0,
        totalObjects: value.indexObjects.length,
        lastError: null,
        createdAt: '2026-09-20T12:00:00.000Z',
        updatedAt: '2026-09-20T12:00:00.000Z',
        completedAt: null,
      };
      nextId += 1;
      staged.clear();
      return snapshot();
    },
    async stats(id) {
      calls.push({ method: 'stats', id });
      const values = [...staged.values()];
      const readyValues = values.filter(
        (item) => item.geometryStatus !== 'unbuildable',
      );
      const names = new Map();
      for (const item of readyValues) {
        names.set(item.name, (names.get(item.name) ?? 0) + 1);
      }
      return {
        stagedObjects: values.length,
        geometryObjects: readyValues.length,
        unbuildableGeometryObjects: values.length - readyValues.length,
        cityPlaces: readyValues.filter(
          (item) => item.placeType === 'city',
        ).length,
        townPlaces: readyValues.filter(
          (item) => item.placeType === 'town',
        ).length,
        administrativePlaces: readyValues.filter(
          (item) =>
            item.adminLevel !== null &&
            item.adminLevel !== undefined,
        ).length,
        duplicateNames: [...names.values()].filter((count) => count > 1).length,
      };
    },
    async checksums(id) {
      calls.push({ method: 'checksums', id });
      return [...staged.values()]
        .sort((left, right) =>
          left.osmType.localeCompare(right.osmType) ||
          left.osmId - right.osmId)
        .map((item) => ({
          osmType: item.osmType,
          osmId: String(item.osmId),
          contentChecksum: item.contentChecksum,
        }));
    },
  };
}

async function createFailedCheckpoint({
  checkpointRepository,
  controller,
} = {}) {
  const repository = checkpointRepository ?? createCheckpointRepositoryMock();
  const pool = createPool();
  let downloadCall = 0;
  let indexParseCall = 0;
  const service = createOsmCityUpdateService(pool, config, {
    checkpointRepository: repository,
    async download(_url, query) {
      downloadCall += 1;
      if (downloadCall === 6) {
        throw new Error('simulated crash near completion');
      }
      return {
        jsonText: downloadCall <= 4
          ? `index-${downloadCall}`
          : 'batch-1',
        bytes: 10,
        finalURL: config.url,
        query,
      };
    },
    parseIndex() {
      const parsed = indexParts[indexParseCall];
      indexParseCall += 1;
      return parsed;
    },
    parseBatch() {
      return batches[0];
    },
    reportProgress() {},
  });

  await assert.rejects(
    service.update(undefined, {}, controller
      ? {
          signal: controller.signal,
          onProgress(progress) {
            if (progress.phase === 'geometry') {
              controller.abort(new Error('cancel checkpoint test'));
            }
          },
        }
      : {}),
    controller ? /cancel checkpoint test/ : /simulated crash/,
  );
  return { repository, pool };
}

function createDependencies(overrides = {}) {
  let downloadCall = 0;
  let indexParseCall = 0;
  let batchParseCall = 0;
  return {
    async download(_url, query) {
      downloadCall += 1;
      return {
        jsonText: downloadCall <= 4
          ? `index-${downloadCall}`
          : `batch-${downloadCall - 4}`,
        bytes: 10,
        finalURL: config.url,
        query,
      };
    },
    parseIndex() {
      const parsed = indexParts[indexParseCall];
      indexParseCall += 1;
      return parsed;
    },
    parseBatch() {
      const parsed = batches[batchParseCall];
      batchParseCall += 1;
      return parsed;
    },
    reportProgress() {},
    ...overrides,
  };
}

test('OSM resume survives failure and skips already staged objects', async () => {
  const { repository } = await createFailedCheckpoint();

  assert.equal(repository.state.status, 'failed');
  assert.equal(repository.state.stagedObjects, 2);
  assert.equal(repository.state.remainingObjects, 1);

  const pool = createPool();
  const progress = [];
  const queries = [];
  const service = createOsmCityUpdateService(pool, config, {
    checkpointRepository: repository,
    async download(_url, query) {
      queries.push(query);
      return {
        jsonText: 'resume-last',
        bytes: 10,
        finalURL: config.url,
        query,
      };
    },
    parseBatch() {
      return batches[1];
    },
    reportProgress(value) {
      progress.push(value);
    },
  });

  const result = await service.update(undefined, { resume: 'true' });

  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0], /out ids/);
  assert.match(queries[0], /way\(id:9\)/);
  assert.doesNotMatch(queries[0], /relation\(id:7\)|way\(id:8\)/);
  assert.equal(result.resumed, true);
  assert.equal(result.reusedObjects, 2);
  assert.equal(result.importedPlaces, 3);
  assert.equal(result.batchCount, 2);
  assert.equal(result.updateRunId, 9);
  assert.deepEqual(
    progress.filter((item) => item.phase === 'resume')
      .map((item) => ({
        stagedPlaces: item.stagedPlaces,
        indexedPlaces: item.indexedPlaces,
        remainingPlaces: item.remainingPlaces,
      })),
    [{
      stagedPlaces: 2,
      indexedPlaces: 3,
      remainingPlaces: 1,
    }],
  );
  assert.ok(pool.queries.includes('BEGIN'));
  assert.ok(pool.queries.includes('COMMIT'));
  assert.ok(pool.queries.some((query) =>
    query.startsWith('DELETE FROM osm_city_update_checkpoint_stage')));
  assert.ok(pool.queries.some((query) =>
    query.startsWith('UPDATE osm_city_update_checkpoints')));
});

test('OSM resume records unbuildable polygons as processed and excludes them from replacement', async () => {
  const repository = createCheckpointRepositoryMock({
    unbuildableKeys: new Set(['way/9']),
  });
  await createFailedCheckpoint({ checkpointRepository: repository });

  const pool = createPool({ stageCount: 2, boundaryCount: 2 });
  const progress = [];
  const queries = [];
  const service = createOsmCityUpdateService(pool, config, {
    checkpointRepository: repository,
    async download(_url, query) {
      queries.push(query);
      return {
        jsonText: 'resume-unbuildable',
        bytes: 10,
        finalURL: config.url,
        query,
      };
    },
    parseBatch() {
      return batches[1];
    },
    reportProgress(value) {
      progress.push(value);
    },
  });

  const result = await service.update(undefined, { resume: 'true' });

  assert.equal(queries.length, 1);
  assert.match(queries[0], /way\(id:9\)/);
  assert.equal(repository.state.status, 'completed');
  assert.equal(repository.state.stagedObjects, 0);
  assert.equal(repository.state.remainingObjects, 0);
  assert.ok(repository.calls.some((call) =>
    call.method === 'stageBatch' && call.keys.includes('way/9')));
  assert.ok(repository.calls.some((call) =>
    call.method === 'complete'));
  assert.equal(result.indexedPlaces, 3);
  assert.equal(result.importedPlaces, 2);
  assert.equal(result.unbuildableGeometryPlaces, 1);
  assert.deepEqual(
    progress.filter((item) => item.phase === 'geometry')
      .map((item) => ({
        stagedPlaces: item.stagedPlaces,
        geometryPlaces: item.geometryPlaces,
        unbuildableGeometryPlaces: item.unbuildableGeometryPlaces,
        batchUnbuildableGeometryPlaces:
          item.batchUnbuildableGeometryPlaces,
      })),
    [{
      stagedPlaces: 3,
      geometryPlaces: 2,
      unbuildableGeometryPlaces: 1,
      batchUnbuildableGeometryPlaces: 1,
    }],
  );
  assert.ok(pool.queries.includes('COMMIT'));
});

test('OSM resume rejects incompatible batch semantics before downloading', async () => {
  const { repository } = await createFailedCheckpoint();
  let downloads = 0;
  const service = createOsmCityUpdateService(createPool(), {
    ...config,
    batchSize: 1,
  }, {
    checkpointRepository: repository,
    async download() {
      downloads += 1;
      throw new Error('must not download');
    },
  });

  await assert.rejects(
    service.update(undefined, { resume: 'true' }),
    /checkpoint is incompatible/,
  );
  assert.equal(downloads, 0);
  assert.equal(repository.state.stagedObjects, 2);
});

test('OSM cancellation keeps the durable checkpoint resumable', async () => {
  const controller = new AbortController();
  const repository = createCheckpointRepositoryMock();
  await createFailedCheckpoint({ checkpointRepository: repository, controller });

  assert.equal(repository.state.status, 'cancelled');
  assert.equal(repository.state.stagedObjects, 2);
  assert.equal(repository.state.remainingObjects, 1);
});

test('explicit OSM restart replaces old checkpoint only after the new index succeeds', async () => {
  const { repository } = await createFailedCheckpoint();
  const oldCheckpointId = repository.state.id;
  const oldStagedObjects = repository.state.stagedObjects;

  let downloadCall = 0;
  let indexParseCall = 0;
  const service = createOsmCityUpdateService(createPool(), config, {
    checkpointRepository: repository,
    async download(_url, query) {
      downloadCall += 1;
      if (downloadCall === 5) {
        throw new Error('stop after replacement checkpoint was created');
      }
      return {
        jsonText: `index-${downloadCall}`,
        bytes: 10,
        finalURL: config.url,
        query,
      };
    },
    parseIndex() {
      const parsed = indexParts[indexParseCall];
      indexParseCall += 1;
      return parsed;
    },
    reportProgress() {},
  });

  await assert.rejects(
    service.update(undefined, { restart: 'true' }),
    /stop after replacement checkpoint was created/,
  );

  assert.equal(downloadCall, 5);
  assert.notEqual(repository.state.id, oldCheckpointId);
  assert.equal(repository.state.stagedObjects, 0);
  assert.equal(repository.state.totalObjects, 3);
  assert.equal(
    repository.calls.filter(
      (call) => call.method === 'replaceResumable',
    ).length,
    1,
  );
  assert.equal(oldStagedObjects, 2);
});

test('OSM fresh start refuses to discard unfinished checkpoint implicitly', async () => {
  const { repository } = await createFailedCheckpoint();
  let downloads = 0;
  const service = createOsmCityUpdateService(
    createPool(),
    config,
    {
      checkpointRepository: repository,
      async download() {
        downloads += 1;
        throw new Error('must not download');
      },
    },
  );

  await assert.rejects(
    service.update(undefined, {}),
    /resume it or explicitly start over/,
  );
  assert.equal(downloads, 0);
  assert.equal(repository.state.stagedObjects, 2);
});

test('OSM update stages sequential ID batches before one atomic replacement', async () => {
  const pool = createPool();
  const progress = [];
  const operationProgress = [];
  const downloadQueries = [];
  const base = createDependencies();
  const service = createOsmCityUpdateService(pool, config, {
    ...base,
    async download(url, query, options) {
      downloadQueries.push({ url, query, maxBytes: options.maxBytes });
      return base.download(url, query, options);
    },
    reportProgress(value) {
      progress.push(value);
    },
  });

  const result = await service.update(undefined, {}, {
    onProgress(value) {
      operationProgress.push(value);
    },
  });

  assert.equal(result.importedPlaces, 3);
  assert.equal(result.cityPlaces, 1);
  assert.equal(result.townPlaces, 2);
  assert.equal(result.administrativePlaces, 0);
  assert.equal(result.duplicateIndexObjects, 0);
  assert.equal(result.duplicateNames, 1);
  assert.equal(result.batchSize, 2);
  assert.equal(result.batchCount, 2);
  assert.equal(result.downloadedBytes, 60);
  assert.equal(result.indexRequestCount, 4);
  assert.equal(result.updateRunId, 9);
  assert.equal(downloadQueries.length, 6);
  assert.match(downloadQueries[0].query, /out ids/);
  assert.match(downloadQueries[0].query, /way\(area\.ru\)\["place"="city"\]/);
  assert.match(downloadQueries[1].query, /relation\(area\.ru\)\["place"="city"\]/);
  assert.match(downloadQueries[2].query, /way\(area\.ru\)\["place"="town"\]/);
  assert.match(downloadQueries[3].query, /relation\(area\.ru\)\["place"="town"\]/);
  assert.match(downloadQueries[4].query, /relation\(id:7\)/);
  assert.match(downloadQueries[4].query, /way\(id:8\)/);
  assert.match(downloadQueries[5].query, /way\(id:9\)/);
  assert.deepEqual(downloadQueries.map((item) => item.maxBytes), [
    1000000,
    1000000,
    1000000,
    1000000,
    1000000,
    1000000,
  ]);
  assert.deepEqual(progress.filter((item) => item.phase === 'index')
    .map((item) => item.indexedPlaces), [0, 1, 3, 3]);
  assert.deepEqual(progress.filter((item) => item.phase === 'geometry')
    .map((item) => item.stagedPlaces), [2, 3]);
  assert.deepEqual(operationProgress, progress);
  assert.equal(pool.queries[0], 'DROP TABLE IF EXISTS osm_city_boundary_stage');
  assert.match(pool.queries[1], /^CREATE TEMP TABLE osm_city_boundary_stage/);
  assert.equal(pool.queries.filter((query) =>
    query.startsWith('WITH payload_rows AS')).length, 2);
  assert.ok(pool.queries.indexOf('BEGIN') > 0);
  assert.ok(
    pool.queries.indexOf('DELETE FROM city_boundaries') >
      pool.queries.indexOf('BEGIN'),
  );
  assert.equal(
    pool.queries.some((query) => query.startsWith('INSERT INTO cities')),
    false,
  );
  assert.equal(pool.queries.some((query) =>
    /DELETE FROM city_geometries/.test(query)), false);
  assert.equal(pool.queries.at(-2), 'COMMIT');
  assert.equal(pool.queries.at(-1), 'DROP TABLE IF EXISTS osm_city_boundary_stage');
  assert.equal(pool.released, true);
});

test('OSM dry run validates the complete staged replacement and rolls it back', async () => {
  const pool = createPool();
  const service = createOsmCityUpdateService(pool, config, createDependencies());

  const result = await service.update(undefined, { dryRun: 'true' });

  assert.equal(result.dryRun, true);
  assert.equal(pool.queries.at(-2), 'ROLLBACK');
  assert.equal(pool.queries.at(-1), 'DROP TABLE IF EXISTS osm_city_boundary_stage');
  assert.equal(
    pool.queries.some((query) => query.startsWith('INSERT INTO osm_city_update_runs')),
    false,
  );
});

test('oversized OSM geometry batch is split and retried sequentially', async () => {
  const pool = createPool();
  const progress = [];
  let call = 0;
  const service = createOsmCityUpdateService(pool, config, {
    async download(_url, query) {
      call += 1;
      if (call === 5) {
        throw new OsmCityDownloadError(
          'OSM response exceeds the configured size limit',
          {
            code: 'response-size-limit',
            limitBytes: config.maxResponseBytes,
            receivedBytes: config.maxResponseBytes + 1,
          },
        );
      }
      return {
        jsonText: call <= 4 ? `index-${call}` : `geometry-${call}`,
        bytes: 10,
        finalURL: config.url,
        query,
      };
    },
    parseIndex() {
      const parsed = indexParts[call - 1];
      return parsed;
    },
    parseBatch(jsonText) {
      if (jsonText === 'geometry-6') {
        return { ...batches[0], places: [batches[0].places[0]], cityPlaces: 1, townPlaces: 0 };
      }
      if (jsonText === 'geometry-7') {
        return { ...batches[0], places: [batches[0].places[1]], cityPlaces: 0, townPlaces: 1 };
      }
      return batches[1];
    },
    reportProgress(value) {
      progress.push(value);
    },
  });

  const result = await service.update(undefined, {});

  assert.equal(result.importedPlaces, 3);
  assert.equal(result.batchCount, 3);
  assert.equal(result.requestAttemptCount, 8);
  assert.equal(result.downloadedBytes, 70);
  assert.deepEqual(
    progress.filter((item) => item.phase === 'split')
      .map((item) => ({
        objectCount: item.objectCount,
        splitSizes: item.splitSizes,
        batchCount: item.batchCount,
      })),
    [{
      objectCount: 2,
      splitSizes: [1, 1],
      batchCount: 3,
    }],
  );
  assert.equal(pool.queries.filter((query) =>
    query.startsWith('WITH payload_rows AS')).length, 3);
});

test('single oversized OSM object fails with its exact OSM identity', async () => {
  const pool = createPool();
  const base = createDependencies();
  let calls = 0;
  const service = createOsmCityUpdateService(pool, {
    ...config,
    batchSize: 1,
    maxResponseBytes: 1000,
    maxTotalBytes: 10000,
  }, {
    ...base,
    async download(url, query, options) {
      calls += 1;
      if (calls === 5) {
        throw new OsmCityDownloadError(
          'OSM response exceeds the configured size limit',
          {
            code: 'response-size-limit',
            limitBytes: options.maxBytes,
            receivedBytes: options.maxBytes + 1,
          },
        );
      }
      return base.download(url, query, options);
    },
  });

  await assert.rejects(
    service.update(undefined, {}),
    /OSM object relation\/7 exceeds the configured single-response size limit/,
  );
  assert.equal(pool.queries.includes('BEGIN'), false);
});

test('OSM total byte budget is reported separately from one-response limit', async () => {
  const pool = createPool();
  const base = createDependencies();
  const service = createOsmCityUpdateService(pool, {
    ...config,
    maxResponseBytes: 40,
    maxTotalBytes: 45,
  }, {
    ...base,
    async download(url, query, options) {
      if (options.maxBytes < 10) {
        throw new OsmCityDownloadError(
          'OSM response exceeds the configured size limit',
          {
            code: 'response-size-limit',
            limitBytes: options.maxBytes,
            receivedBytes: 10,
          },
        );
      }
      return base.download(url, query, options);
    },
  });

  await assert.rejects(
    service.update(undefined, {}),
    (error) =>
      error instanceof OsmCityDownloadError &&
      error.code === 'total-size-limit' &&
      /total size limit/.test(error.message),
  );
  assert.equal(pool.connections, 1);
  assert.equal(pool.queries.includes('BEGIN'), false);
});

test('a later OSM batch failure leaves production boundaries untouched', async () => {
  const pool = createPool();
  let downloadCall = 0;
  const dependencies = createDependencies({
    async download() {
      downloadCall += 1;
      if (downloadCall === 6) throw new Error('second batch failed');
      return {
        jsonText: downloadCall <= 4 ? `index-${downloadCall}` : 'batch-1',
        bytes: 10,
        finalURL: config.url,
      };
    },
  });
  const service = createOsmCityUpdateService(pool, config, dependencies);

  await assert.rejects(service.update(undefined, {}), /second batch failed/);
  assert.equal(pool.queries.includes('BEGIN'), false);
  assert.equal(pool.queries.includes('DELETE FROM city_boundaries'), false);
  assert.equal(pool.queries.filter((query) =>
    query.startsWith('WITH payload_rows AS')).length, 1);
  assert.equal(pool.queries.at(-1), 'DROP TABLE IF EXISTS osm_city_boundary_stage');
  assert.equal(pool.released, true);
});

test('an incomplete batch is rejected before the production transaction', async () => {
  const pool = createPool();
  let batchParseCall = 0;
  const dependencies = createDependencies({
    parseBatch() {
      const parsed = batches[batchParseCall];
      batchParseCall += 1;
      return batchParseCall === 1
        ? { ...parsed, places: [parsed.places[0]] }
        : parsed;
    },
  });
  const service = createOsmCityUpdateService(pool, config, dependencies);

  await assert.rejects(service.update(undefined, {}), /missing: way\/8/);
  assert.equal(pool.queries.includes('BEGIN'), false);
  assert.equal(pool.queries.includes('DELETE FROM city_boundaries'), false);
  assert.equal(pool.queries.at(-1), 'DROP TABLE IF EXISTS osm_city_boundary_stage');
  assert.equal(pool.released, true);
});

test('OSM index download failure happens before a database connection is opened', async () => {
  const pool = createPool();
  const service = createOsmCityUpdateService(pool, config, {
    async download() {
      throw new Error('network failed');
    },
  });

  await assert.rejects(service.update(undefined, {}), /network failed/);
  assert.equal(pool.connections, 0);
});

test('HTTP 429 waits and retries the same OSM request without advancing the batch', async () => {
  const pool = createPool();
  const base = createDependencies();
  const queries = [];
  const delays = [];
  const progress = [];
  let now = 0;
  let attempts = 0;
  let successfulDownloads = 0;
  const retryConfig = {
    ...config,
    minDelayMs: 5,
    maxRetries: 3,
    retryBaseDelayMs: 30,
    retryMaxDelayMs: 240,
  };
  const service = createOsmCityUpdateService(pool, retryConfig, {
    ...base,
    now: () => now,
    async sleep(milliseconds) {
      delays.push(milliseconds);
      now += milliseconds;
    },
    async download(_url, query, options) {
      attempts += 1;
      queries.push(query);
      assert.equal(options.userAgent, retryConfig.userAgent);
      if (attempts === 5) {
        throw new OsmCityDownloadError('OSM download returned HTTP 429', {
          statusCode: 429,
          retryAfterMs: 60,
          finalURL: retryConfig.url,
        });
      }
      successfulDownloads += 1;
      return {
        jsonText: successfulDownloads <= 4
          ? `index-${successfulDownloads}`
          : `batch-${successfulDownloads - 4}`,
        bytes: 10,
        finalURL: retryConfig.url,
      };
    },
    reportProgress(value) {
      progress.push(value);
    },
  });

  const result = await service.update(undefined, {});

  assert.equal(attempts, 7);
  assert.equal(queries[4], queries[5]);
  assert.deepEqual(delays, [5, 5, 5, 5, 60, 5]);
  assert.equal(result.requestAttemptCount, 7);
  assert.equal(result.retryCount, 1);
  assert.equal(result.retryWaitMs, 60);
  assert.equal(result.throttleWaitMs, 25);
  assert.deepEqual(
    progress.filter((item) => item.phase === 'retry'),
    [{
      phase: 'retry',
      requestPhase: 'geometry',
      batch: 1,
      batchCount: 2,
      objectCount: 2,
      statusCode: 429,
      attempt: 1,
      maxRetries: 3,
      configuredMaxRetries: 3,
      waitMs: 60,
      retryAt: '1970-01-01T00:00:00.080Z',
      retryAfterMs: 60,
      fallbackDelayMs: 30,
    }],
  );
});

test('transient OSM network failure retries the same geometry request', async () => {
  const pool = createPool();
  const base = createDependencies();
  const delays = [];
  const progress = [];
  const queries = [];
  let attempts = 0;
  let successfulDownloads = 0;

  const service = createOsmCityUpdateService(pool, {
    ...config,
    maxRetries: 4,
    retryBaseDelayMs: 10,
    retryMaxDelayMs: 40,
  }, {
    ...base,
    async sleep(milliseconds) {
      delays.push(milliseconds);
    },
    async download(url, query, options) {
      attempts += 1;
      queries.push(query);
      if (attempts === 5) {
        throw new OsmCityDownloadError(
          'OSM download failed: other side closed the socket [UND_ERR_SOCKET]',
          {
            code: 'network-error',
            networkCode: 'UND_ERR_SOCKET',
            networkMessage: 'other side closed the socket',
            retryable: true,
            finalURL: url,
          },
        );
      }
      successfulDownloads += 1;
      return {
        jsonText: successfulDownloads <= 4
          ? `index-${successfulDownloads}`
          : `batch-${successfulDownloads - 4}`,
        bytes: 10,
        finalURL: url,
        query,
        maxBytes: options.maxBytes,
      };
    },
    reportProgress(value) {
      progress.push(value);
    },
  });

  const result = await service.update(undefined, {});

  assert.equal(result.importedPlaces, 3);
  assert.equal(attempts, 7);
  assert.equal(queries[4], queries[5]);
  assert.deepEqual(delays, [10]);
  assert.equal(result.retryCount, 1);

  assert.deepEqual(
    progress.filter((item) => item.phase === 'retry')
      .map((item) => ({
        retryKind: item.retryKind,
        networkCode: item.networkCode,
        networkMessage: item.networkMessage,
        statusCode: item.statusCode,
        attempt: item.attempt,
        maxRetries: item.maxRetries,
        configuredMaxRetries: item.configuredMaxRetries,
      })),
    [{
      retryKind: 'network',
      networkCode: 'UND_ERR_SOCKET',
      networkMessage: 'other side closed the socket',
      statusCode: null,
      attempt: 1,
      maxRetries: 4,
      configuredMaxRetries: 4,
    }],
  );
});

test('non-retryable OSM network failure still stops immediately', async () => {
  const pool = createPool();
  let attempts = 0;
  const service = createOsmCityUpdateService(pool, config, {
    async download() {
      attempts += 1;
      throw new OsmCityDownloadError(
        'OSM download failed: certificate has expired [CERT_HAS_EXPIRED]',
        {
          code: 'network-error',
          networkCode: 'CERT_HAS_EXPIRED',
          networkMessage: 'certificate has expired',
          retryable: false,
        },
      );
    },
  });

  await assert.rejects(
    service.update(undefined, {}),
    /certificate has expired/,
  );
  assert.equal(attempts, 1);
  assert.equal(pool.connections, 0);
});

test('repeated HTTP 504 splits a multi-object geometry batch instead of exhausting the full retry budget', async () => {
  const pool = createPool();
  const base = createDependencies();
  const progress = [];
  const delays = [];
  let indexSuccesses = 0;
  let geometryAttempts = 0;

  const service = createOsmCityUpdateService(pool, {
    ...config,
    batchSize: 2,
    maxRetries: 6,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
  }, {
    ...base,
    async sleep(milliseconds) {
      delays.push(milliseconds);
    },
    async download(url, query, _options) {
      if (/out ids/.test(query)) {
        indexSuccesses += 1;
        return {
          jsonText: `index-${indexSuccesses}`,
          bytes: 10,
          finalURL: url,
          query,
        };
      }

      geometryAttempts += 1;
      if (
        /relation\(id:7\)/.test(query) &&
        /way\(id:8\)/.test(query)
      ) {
        throw new OsmCityDownloadError('OSM download returned HTTP 504', {
          statusCode: 504,
          finalURL: url,
        });
      }

      return {
        jsonText: /relation\(id:7\)/.test(query)
          ? 'geometry-left'
          : /way\(id:8\)/.test(query)
            ? 'geometry-right'
            : 'geometry-tail',
        bytes: 10,
        finalURL: url,
        query,
      };
    },
    parseIndex(jsonText) {
      return indexParts[Number(jsonText.split('-')[1]) - 1];
    },
    parseBatch(jsonText) {
      if (jsonText === 'geometry-left') {
        return {
          ...batches[0],
          places: [batches[0].places[0]],
          cityPlaces: 1,
          townPlaces: 0,
        };
      }
      if (jsonText === 'geometry-right') {
        return {
          ...batches[0],
          places: [batches[0].places[1]],
          cityPlaces: 0,
          townPlaces: 1,
        };
      }
      return batches[1];
    },
    reportProgress(value) {
      progress.push(value);
    },
  });

  const result = await service.update(undefined, {});

  assert.equal(result.importedPlaces, 3);
  assert.equal(result.batchCount, 3);
  assert.equal(geometryAttempts, 7);
  assert.deepEqual(delays, [1, 1, 1]);
  assert.deepEqual(
    progress.filter((item) => item.phase === 'retry')
      .map((item) => ({
        statusCode: item.statusCode,
        attempt: item.attempt,
        maxRetries: item.maxRetries,
        configuredMaxRetries: item.configuredMaxRetries,
        objectCount: item.objectCount,
      })),
    [
      {
        statusCode: 504,
        attempt: 1,
        maxRetries: 3,
        configuredMaxRetries: 6,
        objectCount: 2,
      },
      {
        statusCode: 504,
        attempt: 2,
        maxRetries: 3,
        configuredMaxRetries: 6,
        objectCount: 2,
      },
      {
        statusCode: 504,
        attempt: 3,
        maxRetries: 3,
        configuredMaxRetries: 6,
        objectCount: 2,
      },
    ],
  );
  assert.deepEqual(
    progress.filter((item) => item.phase === 'split')
      .map((item) => ({
        reason: item.reason,
        statusCode: item.statusCode,
        retryCount: item.retryCount,
        objectCount: item.objectCount,
        splitSizes: item.splitSizes,
      })),
    [{
      reason: 'http-504',
      statusCode: 504,
      retryCount: 3,
      objectCount: 2,
      splitSizes: [1, 1],
    }],
  );
});

test('HTTP 504 retries the same OSM index part after backoff', async () => {
  const pool = createPool();
  const base = createDependencies();
  const delays = [];
  const progress = [];
  const queries = [];
  let attempts = 0;
  const service = createOsmCityUpdateService(pool, {
    ...config,
    maxRetries: 1,
    retryBaseDelayMs: 30,
    retryMaxDelayMs: 30,
  }, {
    ...base,
    async download(url, query, options) {
      attempts += 1;
      queries.push(query);
      if (attempts === 1) {
        throw new OsmCityDownloadError('OSM download returned HTTP 504', {
          statusCode: 504,
          finalURL: url,
        });
      }
      return base.download(url, query, options);
    },
    async sleep(milliseconds) {
      delays.push(milliseconds);
    },
    reportProgress(value) {
      progress.push(value);
    },
  });

  const result = await service.update(undefined, {});

  assert.equal(result.importedPlaces, 3);
  assert.equal(attempts, 7);
  assert.equal(queries[0], queries[1]);
  assert.deepEqual(delays, [30]);
  assert.equal(result.retryCount, 1);
  assert.deepEqual(
    progress.filter((item) => item.phase === 'retry')
      .map((item) => ({
        statusCode: item.statusCode,
        requestPhase: item.requestPhase,
        indexPart: item.indexPart,
        waitMs: item.waitMs,
      })),
    [{
      statusCode: 504,
      requestPhase: 'index',
      indexPart: 1,
      waitMs: 30,
    }],
  );
});

test('HTTP 429 stops only after the configured retry limit', async () => {
  const pool = createPool();
  const delays = [];
  let attempts = 0;
  const service = createOsmCityUpdateService(pool, {
    ...config,
    maxRetries: 2,
    retryBaseDelayMs: 10,
    retryMaxDelayMs: 20,
  }, {
    async download() {
      attempts += 1;
      throw new OsmCityDownloadError('OSM download returned HTTP 429', {
        statusCode: 429,
      });
    },
    async sleep(milliseconds) {
      delays.push(milliseconds);
    },
    reportProgress() {},
  });

  await assert.rejects(
    service.update(undefined, {}),
    /HTTP 429 after 2 retries/,
  );
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.equal(pool.connections, 0);
});

test('admin cancellation interrupts an HTTP 429 backoff immediately', async () => {
  const pool = createPool();
  const controller = new AbortController();
  const service = createOsmCityUpdateService(pool, {
    ...config,
    retryBaseDelayMs: 1000,
    retryMaxDelayMs: 1000,
  }, {
    async download() {
      throw new OsmCityDownloadError('OSM download returned HTTP 429', {
        statusCode: 429,
      });
    },
    reportProgress() {},
  });

  await assert.rejects(
    service.update(undefined, {}, {
      signal: controller.signal,
      onProgress(progressValue) {
        if (progressValue.phase === 'retry') {
          controller.abort(new Error('cancelled during retry wait'));
        }
      },
    }),
    /cancelled during retry wait/,
  );
  assert.equal(pool.connections, 0);
});


test('saved OSM source is rejected when deployment allowlist no longer permits it', async () => {
  const pool = createPool();
  const restrictedConfig = {
    ...config,
    allowedURLs: new Set([config.url]),
  };
  const service = createOsmCityUpdateService(pool, restrictedConfig, {
    settingsRepository: {
      async get() {
        return {
          sourceURL: 'https://overpass-api.de/api/status',
          includeCity: true,
          includeTown: true,
          includeAdministrative: true,
          adminLevelMin: 4,
          adminLevelMax: 8,
          batchSize: 2,
          minDelayMs: 0,
          timeoutMs: 180000,
          queryTimeoutSeconds: 120,
          maxResponseBytes: 1000000,
          maxTotalBytes: 2000000,
          maxRetries: 6,
          retryBaseDelayMs: 30000,
          retryMaxDelayMs: 240000,
        };
      },
    },
    async download() {
      throw new Error('download must not start');
    },
  });

  await assert.rejects(
    service.update(undefined, {}),
    /Saved OSM URL is no longer allowed/,
  );
  assert.equal(pool.connections, 0);
});
