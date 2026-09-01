import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeOsmUpdateUrl,
  OsmCityUpdateValidationError,
  resolveOsmCityUpdateRequest,
} from '../src/data/osm-city-update-options.js';

const config = {
  url: 'https://overpass-api.de/api/interpreter',
  allowedHosts: new Set(['overpass-api.de']),
  allowedURLs: new Set(['https://overpass-api.de/api/interpreter']),
  dryRun: false,
  timeoutMs: 180000,
  queryTimeoutSeconds: 120,
  maxBytes: 1000000,
  batchSize: 50,
  maxBatchSize: 200,
  minDelayMs: 5000,
  maxRetries: 6,
  retryBaseDelayMs: 30000,
  retryMaxDelayMs: 240000,
};

test('OSM request uses ENV defaults and accepts bounded request overrides', () => {
  const resolved = resolveOsmCityUpdateRequest(undefined, {
    dryRun: 'true',
    timeoutMs: '5000',
    queryTimeoutSeconds: '30',
    maxBytes: '500000',
    batchSize: '25',
    minDelayMs: '6000',
    maxRetries: '3',
    retryBaseDelayMs: '40000',
    retryMaxDelayMs: '300000',
  }, config);

  assert.equal(resolved.url, config.url);
  assert.equal(resolved.dryRun, true);
  assert.equal(resolved.timeoutMs, 5000);
  assert.equal(resolved.queryTimeoutSeconds, 30);
  assert.equal(resolved.maxBytes, 500000);
  assert.equal(resolved.batchSize, 25);
  assert.equal(resolved.minDelayMs, 6000);
  assert.equal(resolved.maxRetries, 3);
  assert.equal(resolved.retryBaseDelayMs, 40000);
  assert.equal(resolved.retryMaxDelayMs, 300000);
});

test('OSM request URL override is allowlisted and cannot raise ENV limits', () => {
  assert.equal(
    resolveOsmCityUpdateRequest({ URL: config.url }, {}, config).url,
    config.url,
  );
  assert.throws(
    () => normalizeOsmUpdateUrl('http://overpass-api.de/api/interpreter', config.allowedHosts),
    /must use HTTPS/,
  );
  assert.throws(
    () => resolveOsmCityUpdateRequest({ URL: 'https://internal.example' }, {}, config),
    /host is not allowed/,
  );
  assert.throws(
    () => resolveOsmCityUpdateRequest({
      URL: 'https://overpass-api.de/api/status',
    }, {}, config),
    /not in the allowed URL list/,
  );
  assert.throws(
    () => resolveOsmCityUpdateRequest(undefined, { timeoutMs: '180001' }, config),
    OsmCityUpdateValidationError,
  );
  assert.throws(
    () => resolveOsmCityUpdateRequest(undefined, { batchSize: '201' }, config),
    /batchSize must be an integer between 1 and 200/,
  );
  assert.throws(
    () => resolveOsmCityUpdateRequest(undefined, { minDelayMs: '4999' }, config),
    /minDelayMs must be an integer between 5000 and 300000/,
  );
  assert.throws(
    () => resolveOsmCityUpdateRequest(undefined, { maxRetries: '7' }, config),
    /maxRetries must be an integer between 0 and 6/,
  );
});
