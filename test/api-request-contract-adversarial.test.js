import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enforceApiRequestContract,
} from '../src/http/api-request-contract.js';
import {
  detectAdminTransportTampering,
} from '../src/http/admin-request-security.js';

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

async function rejected({
  method = 'GET',
  url,
  headers = {},
}) {
  const incidents = [];
  const request = {
    method,
    originalUrl: url,
    url,
    path:
      url.split('?')[0],
    headers,
    query: {},
    socket: {
      remoteAddress:
        '127.0.0.1',
    },
    async recordApiContractIncident(
      incident,
    ) {
      incidents.push(
        incident,
      );
      return {
        locked: false,
      };
    },
  };
  const res =
    response();
  let nextCalled =
    false;

  await enforceApiRequestContract(
    request,
    res,
    () => {
      nextCalled =
        true;
    },
  );

  return {
    request,
    response: res,
    incidents,
    nextCalled,
  };
}

test('strict API contract rejects method overrides and encoded path tricks', async () => {
  const cases = [
    {
      url:
        '/api/admin/me',
      headers: {
        'x-http-method-override':
          'DELETE',
      },
      reason:
        'method-override-not-allowed',
    },
    {
      url:
        '/api/admin/me',
      headers: {
        'x-method-override':
          'POST',
      },
      reason:
        'method-override-not-allowed',
    },
    {
      url:
        '/api/cities/%2e%2e/geometries',
      reason:
        'unsafe-request-path',
    },
    {
      url:
        '/api/cities/1%2F2/geometries',
      reason:
        'unsafe-request-path',
    },
    {
      url:
        '/api/cities/1%5C2/geometries',
      reason:
        'unsafe-request-path',
    },
  ];

  for (const item of cases) {
    const result =
      await rejected(item);

    assert.equal(
      result.nextCalled,
      false,
      item.url,
    );
    assert.equal(
      result.response.statusCode,
      400,
      item.url,
    );
    assert.equal(
      result.response.body.reason,
      item.reason,
      item.url,
    );
    assert.equal(
      result.incidents[0].reason,
      item.reason,
      item.url,
    );
  }
});

test('strict API contract rejects duplicate, Unicode and control query parameter names', async () => {
  const cases = [
    {
      url:
        '/api/geometries?bbox=1&bbox=2',
      reason:
        'duplicate-query-parameter',
    },
    {
      url:
        '/api/geometries?R%D0%BEleID=1',
      reason:
        'unsafe-query-parameter-name',
    },
    {
      url:
        '/api/geometries?Role%E2%80%8BID=1',
      reason:
        'unsafe-query-parameter-name',
    },
    {
      url:
        '/api/geometries?Role%0DID=1',
      reason:
        'unsafe-query-parameter-name',
    },
    {
      url:
        '/api/geometries?Role%0AID=1',
      reason:
        'unsafe-query-parameter-name',
    },
  ];

  for (const item of cases) {
    const result =
      await rejected(item);

    assert.equal(
      result.response.statusCode,
      400,
      item.url,
    );
    assert.equal(
      result.response.body.reason,
      item.reason,
      item.url,
    );
  }
});

test('strict API contract rejects unknown DTPStat headers and query on mutations', async () => {
  const unknownHeader =
    await rejected({
      url:
        '/api/admin/me',
      headers: {
        'x-dtpstat-not-real':
          '1',
      },
    });

  assert.equal(
    unknownHeader
      .response.body.reason,
    'unsupported-dtpstat-header',
  );

  const mutationQuery =
    await rejected({
      method: 'POST',
      url:
        '/api/admin/login?RoleID=1',
    });

  assert.equal(
    mutationQuery
      .response.body.reason,
    'query-not-allowed-for-mutating-request',
  );
});

test('security context spoof detection is case-insensitive and separator-insensitive', () => {
  const findings =
    detectAdminTransportTampering({
      method: 'POST',
      originalUrl:
        '/api/admin/geometry-editor/sync',
      headers: {
        'x-RoLe-Id': '999',
      },
      query: {
        RoLeId: '999',
        role_id: '999',
        'role.id': '999',
        RoleID: '999',
      },
    });

  assert.deepEqual(
    findings.map(
      (item) => [
        item.source,
        item.key,
      ],
    ),
    [
      [
        'header',
        'x-RoLe-Id',
      ],
      [
        'query',
        'RoLeId',
      ],
      [
        'query',
        'role_id',
      ],
      [
        'query',
        'role.id',
      ],
      [
        'query',
        'RoleID',
      ],
    ],
  );
});
