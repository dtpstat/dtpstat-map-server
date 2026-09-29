import assert from 'node:assert/strict';
import test from 'node:test';
import {
  respondAdminAuthenticationFailure,
} from '../src/http/admin-auth-response.js';
import {
  adminCsrfAllowed,
} from '../src/http/admin-csrf.js';
import {
  adminSessionCookie,
  adminSessionCookieName,
  adminSessionToken,
  applyAdminSessionContext,
  clearAdminSessionCookie,
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

test('production admin session cookie uses a strict __Host contract', () => {
  const request = {
    headers: {
      cookie:
        'dtpstat_admin_session=legacy; __Host-dtpstat_admin_session=host%20token',
    },
  };

  assert.equal(
    adminSessionCookieName({
      secureOnly: true,
    }),
    '__Host-dtpstat_admin_session',
  );
  assert.equal(
    adminSessionToken(
      request,
      {
        secureOnly: true,
      },
    ),
    'host token',
  );
  assert.equal(
    adminSessionToken(
      {
        headers: {
          cookie:
            'dtpstat_admin_session=legacy',
        },
      },
      {
        secureOnly: true,
      },
    ),
    null,
  );

  const cookie =
    adminSessionCookie(
      'token value',
      3600,
      {
        secureOnly: true,
        secure: false,
      },
    );

  assert.equal(
    cookie,
    '__Host-dtpstat_admin_session=token%20value; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600; Secure',
  );
  assert.equal(
    cookie.includes('Domain='),
    false,
  );
  assert.equal(
    clearAdminSessionCookie({
      secureOnly: true,
    }),
    '__Host-dtpstat_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure',
  );
});

test('admin CSRF policy requires an exact-origin browser session for mutations', () => {
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
        get(name) {
          if (
            String(name)
              .toLowerCase() ===
            'origin'
          ) {
            return null;
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
        get(name) {
          if (
            String(name)
              .toLowerCase() ===
            'sec-fetch-site'
          ) {
            return 'same-site';
          }

          return request.get(name);
        },
      },
      'session',
    ),
    false,
  );
});

test('admin auth response mapper preserves lockout status without Basic challenge', () => {
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
  assert.equal(
    unknown.headers.has(
      'www-authenticate',
    ),
    false,
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
