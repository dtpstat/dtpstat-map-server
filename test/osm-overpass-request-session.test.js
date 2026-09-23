import assert from 'node:assert/strict';
import test from 'node:test';
import { OsmCityDownloadError } from '../src/data/osm-city-downloader.js';
import {
  createOverpassRequestSession,
} from '../src/modules/osm/overpass-request-session.js';

function createMetrics(overrides = {}) {
  return {
    downloadedBytes: 0,
    requestAttemptCount: 0,
    retryCount: 0,
    retryWaitMs: 0,
    throttleWaitMs: 0,
    ...overrides,
  };
}

const options = {
  url: 'https://overpass-api.de/api/interpreter',
  timeoutMs: 1000,
  maxResponseBytes: 1000,
  maxTotalBytes: 5000,
  minDelayMs: 0,
  maxRetries: 5,
  retryBaseDelayMs: 100,
  retryMaxDelayMs: 1000,
};

const config = {
  allowedHosts: new Set(['overpass-api.de']),
  userAgent: 'test',
};

test('OSM Overpass request session owns byte accounting and transport options', async () => {
  const metrics = createMetrics({ downloadedBytes: 450 });
  const downloadedValues = [];
  const calls = [];
  const session = createOverpassRequestSession({
    config,
    options: {
      ...options,
      maxResponseBytes: 800,
      maxTotalBytes: 1000,
    },
    metrics,
    signal: undefined,
    now: () => 1000,
    sleep: async () => {},
    assertNotCancelled() {},
    onDownloaded(value) {
      downloadedValues.push(value);
    },
    async download(url, query, downloadOptions) {
      calls.push({ url, query, downloadOptions });
      return {
        jsonText: '{"elements":[]}',
        bytes: 120,
        finalURL: url,
      };
    },
  });

  const result = await session.downloadQuery('out;', {
    requestPhase: 'index',
  });

  assert.equal(result.bytes, 120);
  assert.equal(metrics.downloadedBytes, 570);
  assert.equal(metrics.requestAttemptCount, 1);
  assert.equal(metrics.retryCount, 0);
  assert.equal(calls[0].downloadOptions.maxBytes, 550);
  assert.equal(calls[0].downloadOptions.timeoutMs, 1000);
  assert.equal(calls[0].downloadOptions.userAgent, 'test');
  assert.deepEqual(downloadedValues, [result]);
});

test('OSM Overpass request session retries transient failures and reports retry metadata', async () => {
  const metrics = createMetrics();
  const waits = [];
  const progress = [];
  let calls = 0;
  const session = createOverpassRequestSession({
    config,
    options,
    metrics,
    signal: undefined,
    now: () => 1000,
    assertNotCancelled() {},
    async sleep(milliseconds) {
      waits.push(milliseconds);
    },
    emitProgress(value) {
      progress.push(value);
    },
    async download() {
      calls += 1;
      if (calls === 1) {
        throw new OsmCityDownloadError('busy', {
          statusCode: 429,
          retryAfterMs: 350,
        });
      }
      return {
        jsonText: '{"elements":[]}',
        bytes: 10,
        finalURL: options.url,
      };
    },
  });

  await session.downloadQuery('out;', {
    requestPhase: 'index',
    indexPart: 1,
    indexPartCount: 1,
  });

  assert.equal(calls, 2);
  assert.deepEqual(waits, [350]);
  assert.equal(metrics.requestAttemptCount, 2);
  assert.equal(metrics.retryCount, 1);
  assert.equal(metrics.retryWaitMs, 350);
  assert.deepEqual(progress.map((item) => ({
    phase: item.phase,
    statusCode: item.statusCode,
    attempt: item.attempt,
    maxRetries: item.maxRetries,
    waitMs: item.waitMs,
  })), [{
    phase: 'retry',
    statusCode: 429,
    attempt: 1,
    maxRetries: 5,
    waitMs: 350,
  }]);
});

test('OSM Overpass geometry 504 uses the bounded retry budget before split', async () => {
  const metrics = createMetrics();
  const waits = [];
  let calls = 0;
  const session = createOverpassRequestSession({
    config,
    options,
    metrics,
    signal: undefined,
    now: () => 1000,
    assertNotCancelled() {},
    async sleep(milliseconds) {
      waits.push(milliseconds);
    },
    async download() {
      calls += 1;
      throw new OsmCityDownloadError('gateway timeout', {
        statusCode: 504,
      });
    },
  });

  await assert.rejects(
    session.downloadQuery('out;', {
      requestPhase: 'geometry',
      objectCount: 4,
      batch: 1,
    }),
    (error) => {
      assert.ok(error instanceof OsmCityDownloadError);
      assert.equal(error.code, 'geometry-504-retry-limit');
      assert.equal(error.statusCode, 504);
      assert.equal(error.retryCount, 3);
      assert.equal(error.configuredMaxRetries, 5);
      return true;
    },
  );

  assert.equal(calls, 4);
  assert.deepEqual(waits, [100, 200, 400]);
  assert.equal(metrics.requestAttemptCount, 4);
  assert.equal(metrics.retryCount, 3);
  assert.equal(metrics.retryWaitMs, 700);
});

test('OSM Overpass request session enforces the aggregate byte ceiling before download', async () => {
  const metrics = createMetrics({ downloadedBytes: 5000 });
  let calls = 0;
  const session = createOverpassRequestSession({
    config,
    options,
    metrics,
    signal: undefined,
    now: () => 1000,
    sleep: async () => {},
    assertNotCancelled() {},
    async download() {
      calls += 1;
      throw new Error('must not run');
    },
  });

  await assert.rejects(
    session.downloadQuery('out;', { requestPhase: 'index' }),
    (error) => {
      assert.ok(error instanceof OsmCityDownloadError);
      assert.equal(error.code, 'total-size-limit');
      assert.equal(error.limitBytes, 5000);
      assert.equal(error.receivedBytes, 5000);
      return true;
    },
  );
  assert.equal(calls, 0);
});
