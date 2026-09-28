import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  createAdminAuthorization,
} from '../src/http/admin-auth.js';

function response() {
  const emitter =
    new EventEmitter();

  return Object.assign(
    emitter,
    {
      headers: new Map(),
      statusCode: 200,
      body: null,
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
    },
  );
}

function request(overrides = {}) {
  return {
    method: 'GET',
    path:
      '/api/admin/me',
    originalUrl:
      '/api/admin/me',
    headers: {},
    query: {},
    protocol: 'https',
    socket: {
      remoteAddress:
        '127.0.0.1',
    },
    get(name) {
      return this.headers[
        String(name)
          .toLowerCase()
      ];
    },
    ...overrides,
  };
}

function authService(audits) {
  return {
    async authenticateRequest() {
      return {
        status: 'success',
        authMethod: 'session',
        sessionId: 1,
        sessionEffectiveExpiresAt:
          '2026-09-28T12:00:00.000Z',
        securitySettings: {
          requestRateLimitUserPerMinute:
            10,
          requestRateLimitGlobalPerMinute:
            100,
        },
        user: {
          id: 7,
          username:
            'operator',
          isSuperuser: true,
          mustChangePassword:
            false,
        },
      };
    },
    async appendAudit(entry) {
      audits.push(entry);
    },
  };
}

test('admin authorization blocks query and header identity override attempts', async () => {
  const audits = [];
  const adminAuth =
    createAdminAuthorization(
      authService(audits),
    );
  const req =
    request({
      query: {
        userId: '999',
      },
      headers: {
        'x-role-mode':
          'superuser',
      },
    });
  const res =
    response();
  let nextCalled =
    false;

  await adminAuth.requireProfile(
    req,
    res,
    () => {
      nextCalled =
        true;
    },
  );

  assert.equal(
    nextCalled,
    false,
  );
  assert.equal(
    res.statusCode,
    400,
  );

  await new Promise(
    (resolve) =>
      setImmediate(resolve),
  );

  assert.equal(
    audits[0]
      .operationType,
    'admin.request.tamper',
  );
  assert.deepEqual(
    audits[0]
      .details
      .fields
      .map(
        (item) =>
          item.key,
      ),
    [
      'x-role-mode',
      'userId',
    ],
  );
});

test('admin authorization returns 429 when request budget is exhausted', async () => {
  const audits = [];
  const adminAuth =
    createAdminAuthorization(
      authService(audits),
      {
        requestRateLimiter: {
          consumeUser() {
            return {
              allowed: false,
              scope: 'user',
              limit: 10,
              retryAfterSeconds:
                17,
            };
          },
          consumeGlobal() {
            return {
              allowed: true,
            };
          },
        },
      },
    );
  const req =
    request();
  const res =
    response();

  await adminAuth.requireProfile(
    req,
    res,
    () => {
      throw new Error(
        'next must not run',
      );
    },
  );

  assert.equal(
    res.statusCode,
    429,
  );
  assert.equal(
    res.headers.get(
      'retry-after',
    ),
    '17',
  );
  assert.equal(
    res.body.code,
    'admin_request_rate_limited',
  );
});


test('global admin request limiter blocks before authentication and uses cached security settings', async () => {
  let authenticated = 0;
  let settingsReads = 0;
  const audits = [];
  const service = {
    async getSecuritySettings() {
      settingsReads += 1;
      return {
        requestRateLimitUserPerMinute:
          10,
        requestRateLimitGlobalPerMinute:
          20,
      };
    },
    async authenticateRequest() {
      authenticated += 1;
      throw new Error(
        'authentication must not run',
      );
    },
    async appendAudit(entry) {
      audits.push(entry);
    },
  };
  const adminAuth =
    createAdminAuthorization(
      service,
      {
        requestRateLimiter: {
          consumeGlobal() {
            return {
              allowed: false,
              scope: 'global',
              limit: 20,
              shouldLog: true,
              retryAfterSeconds:
                12,
            };
          },
          consumeUser() {
            throw new Error(
              'user limiter must not run',
            );
          },
        },
        rateSettingsCacheMs:
          60_000,
      },
    );

  const first =
    response();
  await adminAuth
    .limitGlobalRequest(
      request(),
      first,
      () => {
        throw new Error(
          'next must not run',
        );
      },
    );

  assert.equal(
    first.statusCode,
    429,
  );
  assert.equal(
    authenticated,
    0,
  );
  assert.equal(
    settingsReads,
    1,
  );
  assert.equal(
    audits.length,
    1,
  );
  assert.equal(
    audits[0]
      .details.scope,
    'global',
  );

  const second =
    response();
  await adminAuth
    .limitGlobalRequest(
      request(),
      second,
      () => {
        throw new Error(
          'next must not run',
        );
      },
    );

  assert.equal(
    settingsReads,
    1,
  );
});
