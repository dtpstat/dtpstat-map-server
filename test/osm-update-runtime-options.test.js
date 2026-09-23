import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveOsmUpdateRuntimeOptions,
} from '../src/modules/osm/update-runtime-options.js';

const config = {
  url: 'https://overpass-api.de/api/interpreter',
  allowedHosts: new Set(['overpass-api.de']),
  allowedURLs: new Set(['https://overpass-api.de/api/interpreter']),
  includeCity: true,
  includeTown: true,
  includeAdministrative: false,
  adminLevelMin: 4,
  adminLevelMax: 8,
  batchSize: 25,
  minDelayMs: 5000,
  timeoutMs: 180000,
  queryTimeoutSeconds: 120,
  maxResponseBytes: 1000000,
  maxTotalBytes: 2000000,
  maxRetries: 6,
  retryBaseDelayMs: 30000,
  retryMaxDelayMs: 240000,
};

test('OSM runtime options use deployment config when settings storage is absent', async () => {
  const options = await resolveOsmUpdateRuntimeOptions({
    settingsRepository: null,
    config,
    body: undefined,
    query: {},
  });

  assert.equal(options.url, config.url);
  assert.equal(options.batchSize, 25);
  assert.equal(options.maxRetries, 6);
});

test('OSM runtime options overlay saved settings before bounded request overrides', async () => {
  const options = await resolveOsmUpdateRuntimeOptions({
    settingsRepository: {
      async get() {
        return {
          sourceURL: config.url,
          includeCity: true,
          includeTown: false,
          includeAdministrative: true,
          adminLevelMin: 4,
          adminLevelMax: 6,
          batchSize: 10,
          minDelayMs: 3000,
          timeoutMs: 120000,
          queryTimeoutSeconds: 90,
          maxResponseBytes: 900000,
          maxTotalBytes: 1800000,
          maxRetries: 4,
          retryBaseDelayMs: 10000,
          retryMaxDelayMs: 60000,
        };
      },
    },
    config,
    body: undefined,
    query: {
      batchSize: '5',
      maxRetries: '2',
    },
  });

  assert.equal(options.includeTown, false);
  assert.equal(options.includeAdministrative, true);
  assert.equal(options.batchSize, 5);
  assert.equal(options.maxRetries, 2);
  assert.equal(options.maxResponseBytes, 900000);
});

test('OSM runtime options reject a saved source outside the deployment URL allowlist', async () => {
  await assert.rejects(
    resolveOsmUpdateRuntimeOptions({
      settingsRepository: {
        async get() {
          return {
            sourceURL: 'https://overpass-api.de/api/status',
          };
        },
      },
      config,
      body: undefined,
      query: {},
    }),
    /Saved OSM URL is no longer allowed/u,
  );
});
