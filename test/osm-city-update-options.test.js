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
  dryRun: false,
  timeoutMs: 180000,
  queryTimeoutSeconds: 120,
  maxBytes: 1000000,
  batchSize: 50,
  maxBatchSize: 200,
};

test('OSM request uses ENV defaults and accepts bounded request overrides', () => {
  const resolved = resolveOsmCityUpdateRequest(undefined, {
    dryRun: 'true',
    timeoutMs: '5000',
    queryTimeoutSeconds: '30',
    maxBytes: '500000',
    batchSize: '25',
  }, config);

  assert.equal(resolved.url, config.url);
  assert.equal(resolved.dryRun, true);
  assert.equal(resolved.timeoutMs, 5000);
  assert.equal(resolved.queryTimeoutSeconds, 30);
  assert.equal(resolved.maxBytes, 500000);
  assert.equal(resolved.batchSize, 25);
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
    () => resolveOsmCityUpdateRequest(undefined, { timeoutMs: '180001' }, config),
    OsmCityUpdateValidationError,
  );
  assert.throws(
    () => resolveOsmCityUpdateRequest(undefined, { batchSize: '201' }, config),
    /batchSize must be an integer between 1 and 200/,
  );
});
