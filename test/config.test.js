import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

const REQUIRED_ENV = {
  DATABASE_URL: 'postgresql://localhost/example',
  MAPBOX_ACCESS_TOKEN: 'pk.test',
  IMPORT_API_USERNAME: 'importer',
  IMPORT_API_PASSWORD: 'test-secret',
};

test('loadConfig enables HTTP with safe defaults', () => {
  const config = loadConfig(REQUIRED_ENV, '/project');

  assert.deepEqual(config.http, { enabled: true, port: 3000 });
  assert.equal(config.https.enabled, false);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.database.maxConnections, 10);
  assert.equal(config.importApi.maxBodyBytes, 25 * 1024 * 1024);
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

test('loadConfig requires database, map, and import credentials', () => {
  assert.throws(
    () =>
      loadConfig(
        {
          MAPBOX_ACCESS_TOKEN: 'pk.test',
          IMPORT_API_USERNAME: 'importer',
          IMPORT_API_PASSWORD: 'secret',
        },
        '/project',
      ),
    /DATABASE_URL is required/,
  );
  assert.throws(
    () =>
      loadConfig(
        {
          DATABASE_URL: 'postgresql:\/\/db',
          IMPORT_API_USERNAME: 'importer',
          IMPORT_API_PASSWORD: 'secret',
        },
        '/project',
      ),
    /MAPBOX_ACCESS_TOKEN is required/,
  );
  assert.throws(
    () =>
      loadConfig(
        {
          DATABASE_URL: 'postgresql:\/\/db',
          MAPBOX_ACCESS_TOKEN: 'pk.test',
        },
        '/project',
      ),
    /IMPORT_API_USERNAME is required/,
  );
});
