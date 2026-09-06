import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

const REQUIRED_ENV = {
  DATABASE_NAME: 'example',
  DATABASE_ROLE: 'example_app',
  DATABASE_ROLE_PASSWORD: 'database-secret',
  MAPBOX_ACCESS_TOKEN: 'pk.test',
  IMPORT_API_USERNAME: 'importer',
  IMPORT_API_PASSWORD: 'test-secret',
};

test('loadConfig enables HTTP with safe defaults', () => {
  const config = loadConfig(REQUIRED_ENV, '/project');

  assert.deepEqual(config.http, {
    enabled: true,
    port: 3000,
    trustProxyHops: 0,
  });
  assert.equal(config.https.enabled, false);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.database.maxConnections, 10);
  assert.equal(config.database.host, '127.0.0.1');
  assert.equal(config.database.port, 5432);
  assert.equal(config.database.user, 'example_app');
  assert.equal(config.database.schema, 'buslanes');
  assert.equal(config.importApi.bootstrapUsername, 'importer');
  assert.equal(config.importApi.bootstrapPassword, 'test-secret');
  assert.equal(config.importApi.maxBodyBytes, 25 * 1024 * 1024);
  assert.equal(config.kmlUpdate.sources.length, 0);
  assert.equal(config.kmlUpdate.timeoutMs, 30000);
  assert.equal(config.kmlUpdate.unmatchedPolicy, 'skip');
  assert.equal(config.kmlUpdate.ambiguousPolicy, 'best-overlap');
  assert.equal(config.kmlUpdate.cityBufferMeters, 0);
  assert.equal(config.kmlUpdate.cityBufferMaxMeters, 5000);
  assert.deepEqual([...config.kmlUpdate.allowedHosts], ['www.google.com']);
  assert.equal(
    config.osmCityUpdate.url,
    'https://overpass-api.de/api/interpreter',
  );
  assert.equal(config.osmCityUpdate.queryTimeoutSeconds, 300);
  assert.equal(config.osmCityUpdate.timeoutMs, 600000);
  assert.equal(config.osmCityUpdate.batchSize, 50);
  assert.equal(config.osmCityUpdate.maxBatchSize, 200);
  assert.equal(config.osmCityUpdate.minDelayMs, 5000);
  assert.equal(config.osmCityUpdate.maxRetries, 6);
  assert.equal(config.osmCityUpdate.retryBaseDelayMs, 30000);
  assert.equal(config.osmCityUpdate.retryMaxDelayMs, 240000);
  assert.equal(
    config.osmCityUpdate.userAgent,
    'buslanes/2.0 OSM city updater',
  );
  assert.deepEqual(
    [...config.osmCityUpdate.allowedHosts],
    [
      'overpass-api.de',
      'overpass.kumi.systems',
      'overpass.private.coffee',
      'maps.mail.ru',
    ],
  );
  assert.deepEqual(
    [...config.osmCityUpdate.allowedURLs],
    [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ],
  );
});

test('loadConfig allows removing bootstrap credentials after ADMIN_USERS exists', () => {
  const config = loadConfig({
    DATABASE_NAME: 'example',
    DATABASE_ROLE: 'example_app',
    DATABASE_ROLE_PASSWORD: 'database-secret',
    MAPBOX_ACCESS_TOKEN: 'pk.test',
  }, '/project');

  assert.equal(config.importApi.bootstrapUsername, null);
  assert.equal(config.importApi.bootstrapPassword, null);
});

test('loadConfig configures only explicit trusted reverse proxy hops', () => {
  const config = loadConfig({
    ...REQUIRED_ENV,
    HTTP_TRUST_PROXY_HOPS: '1',
  }, '/project');
  assert.equal(config.http.trustProxyHops, 1);

  assert.throws(
    () => loadConfig({
      ...REQUIRED_ENV,
      HTTP_TRUST_PROXY_HOPS: '17',
    }, '/project'),
    /HTTP_TRUST_PROXY_HOPS must be an integer between 0 and 16/,
  );
});

test('loadConfig derives instance defaults from DATABASE_SCHEMA', () => {
  const config = loadConfig({
    ...REQUIRED_ENV,
    DATABASE_SCHEMA: 'tramlanes',
  }, '/project');

  assert.equal(config.database.schema, 'tramlanes');
  assert.equal(config.osmCityUpdate.userAgent, 'tramlanes/2.0 OSM city updater');

  const explicitUserAgent = loadConfig({
    ...REQUIRED_ENV,
    DATABASE_SCHEMA: 'tramlanes',
    OSM_CITY_UPDATE_USER_AGENT: 'custom-agent/1.0',
  }, '/project');
  assert.equal(explicitUserAgent.osmCityUpdate.userAgent, 'custom-agent/1.0');
});

test('loadConfig requires the default OSM endpoint in the exact URL allowlist', () => {
  assert.throws(
    () => loadConfig({
      ...REQUIRED_ENV,
      OSM_CITY_UPDATE_ALLOWED_URLS:
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    }, '/project'),
    /OSM_CITY_UPDATE_URL must be included/,
  );
});

test('loadConfig keeps the OSM geometry batch within its configured maximum', () => {
  const config = loadConfig({
    ...REQUIRED_ENV,
    OSM_CITY_UPDATE_BATCH_SIZE: '75',
    OSM_CITY_UPDATE_MAX_BATCH_SIZE: '100',
  }, '/project');

  assert.equal(config.osmCityUpdate.batchSize, 75);
  assert.equal(config.osmCityUpdate.maxBatchSize, 100);
  assert.throws(
    () => loadConfig({
      ...REQUIRED_ENV,
      OSM_CITY_UPDATE_BATCH_SIZE: '101',
      OSM_CITY_UPDATE_MAX_BATCH_SIZE: '100',
    }, '/project'),
    /OSM_CITY_UPDATE_BATCH_SIZE must be an integer between 1 and 100/,
  );
});

test('loadConfig validates default KML sources with explicit multipliers', () => {
  const config = loadConfig({
    ...REQUIRED_ENV,
    KML_UPDATE_SOURCES_JSON: JSON.stringify([
      {
        URL: 'https://www.google.com/maps/d/viewer?mid=test_map',
        layers: [
          { name: 'Односторонние', multiple: 1 },
          { name: 'Двусторонние', multiple: 2 },
        ],
      },
    ]),
  }, '/project');

  assert.equal(config.kmlUpdate.sources[0].mapId, 'test_map');
  assert.equal(config.kmlUpdate.sources[0].layers[1].multiple, 2);

  assert.throws(
    () => loadConfig({
      ...REQUIRED_ENV,
      KML_UPDATE_SOURCES_JSON: '[',
    }, '/project'),
    /must contain valid JSON/,
  );
});

test('loadConfig supports HTTPS-only mode and resolves certificate paths', () => {
  const config = loadConfig(
    {
      ...REQUIRED_ENV,
      HTTP_ENABLED: 'false',
      HTTPS_ENABLED: 'true',
      HTTPS_PORT: '9443',
      HTTPS_KEY_PATH: './tls/key.pem',
      HTTPS_CERT_PATH: './tls/cert.pem',
    },
    '/project',
  );

  assert.equal(config.http.enabled, false);
  assert.equal(config.https.port, 9443);
  assert.equal(config.https.keyPath, '/project/tls/key.pem');
  assert.equal(config.https.certPath, '/project/tls/cert.pem');
});

test('loadConfig rejects invalid protocol and port combinations', () => {
  assert.throws(
    () =>
      loadConfig(
        {
          ...REQUIRED_ENV,
          HTTP_ENABLED: 'false',
          HTTPS_ENABLED: 'false',
        },
        '/project',
      ),
    /At least one/,
  );

  assert.throws(
    () =>
      loadConfig(
        {
          ...REQUIRED_ENV,
          HTTP_ENABLED: 'true',
          HTTPS_ENABLED: 'true',
          HTTP_PORT: '3000',
          HTTPS_PORT: '3000',
          HTTPS_KEY_PATH: 'key.pem',
          HTTPS_CERT_PATH: 'cert.pem',
        },
        '/project',
      ),
    /must be different/,
  );
});

test('loadConfig requires database and public map settings, not ongoing admin credentials', () => {
  assert.throws(
    () =>
      loadConfig(
        {
          MAPBOX_ACCESS_TOKEN: 'pk.test',
        },
        '/project',
      ),
    /DATABASE_NAME is required/,
  );
  assert.throws(
    () =>
      loadConfig(
        {
          DATABASE_NAME: 'example',
          DATABASE_ROLE: 'example_app',
          DATABASE_ROLE_PASSWORD: 'database-secret',
        },
        '/project',
      ),
    /MAPBOX_ACCESS_TOKEN is required/,
  );
});
