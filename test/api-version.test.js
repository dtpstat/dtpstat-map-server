import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requireAdminApiVersion,
} from '../src/http/api-version.js';
import {
  DTPSTAT_API_RELOAD_CODE,
  DTPSTAT_API_VERSION,
  DTPSTAT_API_VERSION_HEADER,
} from '../public/js/api-contract.js';

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: new Map(),
    set(name, value) {
      this.headers.set(
        String(name)
          .toLowerCase(),
        String(value),
      );
      return this;
    },
    status(value) {
      this.statusCode =
        value;
      return this;
    },
    json(value) {
      this.body =
        value;
      return this;
    },
  };
}

function request(
  path,
  version,
) {
  const headers = {};

  if (version !== undefined) {
    headers[
      DTPSTAT_API_VERSION_HEADER
        .toLocaleLowerCase(
          'en-US',
        )
    ] = version;
  }

  return {
    method: 'GET',
    path,
    originalUrl: path,
    headers,
    get(name) {
      return this.headers[
        String(name)
          .toLocaleLowerCase(
            'en-US',
          )
      ];
    },
  };
}

test('every admin API request requires the exact current client version', () => {
  for (
    const path of [
      '/api/admin/me',
      '/api/admin/settings/export',
      '/api/admin/export/lines.kml',
      '/api/admin/security/audit/export.csv',
    ]
  ) {
    const missing =
      response();
    let missingNext =
      false;

    requireAdminApiVersion(
      request(path),
      missing,
      () => {
        missingNext =
          true;
      },
    );

    assert.equal(
      missingNext,
      false,
      path,
    );
    assert.equal(
      missing.statusCode,
      426,
      path,
    );
    assert.equal(
      missing.body.code,
      DTPSTAT_API_RELOAD_CODE,
      path,
    );
    assert.equal(
      missing.body
        .requiredVersion,
      DTPSTAT_API_VERSION,
      path,
    );

    const stale =
      response();

    requireAdminApiVersion(
      request(path, '0'),
      stale,
      () => {},
    );

    assert.equal(
      stale.statusCode,
      426,
      path,
    );

    const current =
      response();
    let currentNext =
      false;

    requireAdminApiVersion(
      request(
        path,
        DTPSTAT_API_VERSION,
      ),
      current,
      () => {
        currentNext =
          true;
      },
    );

    assert.equal(
      currentNext,
      true,
      path,
    );
  }
});
