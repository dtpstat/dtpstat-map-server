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
  maxBytes: 1000000,
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

function createPool() {
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
      if (normalized.startsWith('SELECT count(*)::integer')) {
        return { rows: [{ count: 3 }], rowCount: 1 };
      }
      if (normalized.startsWith('WITH name_counts AS') &&
          normalized.includes('INSERT INTO city_boundaries')) {
        return { rows: [], rowCount: 3 };
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
    999990,
    999980,
    999970,
    999960,
    999950,
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
      statusCode: 429,
      attempt: 1,
      maxRetries: 3,
      waitMs: 60,
      retryAt: '1970-01-01T00:00:00.080Z',
      retryAfterMs: 60,
      fallbackDelayMs: 30,
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
