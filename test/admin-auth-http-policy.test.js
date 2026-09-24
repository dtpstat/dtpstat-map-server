import assert from 'node:assert/strict';
import test from 'node:test';
import {
  respondAdminAuthenticationFailure,
} from '../src/http/admin-auth-response.js';
import {
  adminCsrfAllowed,
} from '../src/http/admin-csrf.js';
import {
  adminSessionCookieName,
  adminSessionToken,
  applyAdminSessionContext,
} from '../src/http/admin-session-http.js';

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: new Map(),
    set(name, value) {
      this.headers.set(
        String(name).toLowerCase(),
        String(value),
      );
      return this;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test('admin session HTTP helper parses the stable cookie and exposes effective expiry', () => {
  const request = {
    headers: {
      cookie:
        'other=1; dtpstat_admin_session=token%20value',
    },
  };
  const res = response();

  assert.equal(
    adminSessionCookieName(),
    'dtpstat_admin_session',
  );
  assert.equal(
    adminSessionToken(request),
    'token value',
  );

  applyAdminSessionContext(
    request,
    res,
    {
      user: {
        id: 7,
        username: 'operator',
      },
      authMethod: 'session',
      sessionId: 42,
      sessionEffectiveExpiresAt:
        '2026-09-24T15:00:00.000Z',
    },
  );

  assert.equal(
    request.adminUser.id,
    7,
  );
  assert.equal(
    request.adminSessionId,
    42,
  );
  assert.equal(
    request.adminAuthMethod,
    'session',
  );
  assert.equal(
    request.adminSessionExpiresAt,
    '2026-09-24T15:00:00.000Z',
  );
  assert.equal(
    res.headers.get(
      'x-dtpstat-admin-session-expires-at',
    ),
    '2026-09-24T15:00:00.000Z',
  );
});

test('admin CSRF policy protects mutating session requests without restricting Basic Auth', () => {
  const request = {
    method: 'POST',
    protocol: 'https',
    get(name) {
      const headers = {
        host: 'admin.example',
        origin: 'https://admin.example',
        'sec-fetch-site': 'same-origin',
      };

      return headers[
        String(name).toLowerCase()
      ];
    },
  };

  assert.equal(
    adminCsrfAllowed(
      request,
      'session',
    ),
    true,
  );

  assert.equal(
    adminCsrfAllowed(
      {
        ...request,
        get(name) {
          if (
            String(name).toLowerCase() ===
            'sec-fetch-site'
          ) {
            return 'cross-site';
          }

          return request.get(name);
        },
      },
      'session',
    ),
    false,
  );

  assert.equal(
    adminCsrfAllowed(
      {
        ...request,
        method: 'GET',
        get() {
          return 'cross-site';
        },
      },
      'session',
    ),
    true,
  );

  assert.equal(
    adminCsrfAllowed(
      {
        ...request,
        get() {
          return 'cross-site';
        },
      },
      'basic',
    ),
    true,
  );
});

test('admin auth response mapper preserves lockout status headers and fallback challenge', () => {
  const locked = response();

  assert.equal(
    respondAdminAuthenticationFailure(
      locked,
      {
        status: 'ip-locked',
        retryAfterSeconds: 73,
      },
    ),
    true,
  );

  assert.equal(
    locked.statusCode,
    429,
  );
  assert.equal(
    locked.headers.get(
      'retry-after',
    ),
    '73',
  );
  assert.equal(
    locked.body
      .retryAfterSeconds,
    73,
  );

  const unknown = response();

  assert.equal(
    respondAdminAuthenticationFailure(
      unknown,
      {
        status: 'unexpected',
      },
    ),
    true,
  );

  assert.equal(
    unknown.statusCode,
    401,
  );
  assert.equal(
    unknown.body.error,
    'Invalid username or password',
  );
  assert.match(
    unknown.headers.get(
      'www-authenticate',
    ),
    /^Basic /u,
  );

  const success = response();

  assert.equal(
    respondAdminAuthenticationFailure(
      success,
      {
        status: 'success',
      },
    ),
    false,
  );
  assert.equal(
    success.statusCode,
    200,
  );
});
