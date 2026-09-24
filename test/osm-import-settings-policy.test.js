import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeOsmImportSettingsPayload,
} from '../src/modules/osm/import-settings-policy.js';

const sourceURL =
  'https://overpass-api.de/api/interpreter';

const config = {
  allowedHosts:
    new Set([
      'overpass-api.de',
    ]),
  allowedURLs:
    new Set([
      sourceURL,
    ]),
  maxBatchSize: 200,
};

function validPayload() {
  return {
    sourceURL,
    includeCity: true,
    includeTown: true,
    includeAdministrative: false,
    adminLevelMin: 4,
    adminLevelMax: 8,
    batchSize: 50,
    minDelayMs: 5000,
    timeoutMs: 180000,
    queryTimeoutSeconds: 120,
    maxResponseBytes:
      64 * 1024 * 1024,
    maxTotalBytes:
      512 * 1024 * 1024,
    maxRetries: 6,
    retryBaseDelayMs: 30000,
    retryMaxDelayMs: 240000,
  };
}

test('OSM import settings policy normalizes a complete bounded payload', () => {
  const result =
    normalizeOsmImportSettingsPayload(
      validPayload(),
      config,
    );

  assert.equal(
    result.sourceURL,
    sourceURL,
  );
  assert.equal(result.batchSize, 50);
  assert.equal(
    result.maxRetries,
    6,
  );
  assert.equal(
    result.includeAdministrative,
    false,
  );
});

test('OSM import settings policy rejects unsupported URLs fields and empty object classes', () => {
  assert.throws(
    () =>
      normalizeOsmImportSettingsPayload(
        {
          ...validPayload(),
          extra: true,
        },
        config,
      ),
    /unsupported properties/u,
  );

  assert.throws(
    () =>
      normalizeOsmImportSettingsPayload(
        {
          ...validPayload(),
          sourceURL:
            'https://example.com/api',
        },
        config,
      ),
    /host is not allowed/u,
  );

  assert.throws(
    () =>
      normalizeOsmImportSettingsPayload(
        {
          ...validPayload(),
          includeCity: false,
          includeTown: false,
          includeAdministrative: false,
        },
        config,
      ),
    /At least one OSM object class/u,
  );
});

test('OSM import settings policy enforces dependent bounds', () => {
  assert.throws(
    () =>
      normalizeOsmImportSettingsPayload(
        {
          ...validPayload(),
          adminLevelMin: 9,
          adminLevelMax: 8,
        },
        config,
      ),
    /adminLevelMin must not exceed adminLevelMax/u,
  );

  assert.throws(
    () =>
      normalizeOsmImportSettingsPayload(
        {
          ...validPayload(),
          retryBaseDelayMs: 300000,
          retryMaxDelayMs: 240000,
        },
        config,
      ),
    /retryBaseDelayMs must not exceed retryMaxDelayMs/u,
  );

  assert.throws(
    () =>
      normalizeOsmImportSettingsPayload(
        {
          ...validPayload(),
          maxResponseBytes:
            128 * 1024 * 1024,
          maxTotalBytes:
            64 * 1024 * 1024,
        },
        config,
      ),
    /maxResponseBytes must not exceed maxTotalBytes/u,
  );
});
