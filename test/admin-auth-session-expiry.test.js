import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAuthorization } from '../src/http/admin-auth.js';

function request() {
  return {
    method: 'GET',
    headers: { cookie: 'dtpstat_admin_session=test-token' },
    get(name) {
      if (name.toLowerCase() === 'user-agent') return 'test-agent';
      if (name.toLowerCase() === 'authorization') return undefined;
      return undefined;
    },
    socket: { remoteAddress: '127.0.0.1' },
    protocol: 'https',
  };
}

function response() {
  return {
    headers: new Map(),
    statusCode: 200,
    body: null,
    locals: {},
    set(name, value) {
      this.headers.set(String(name).toLowerCase(), String(value));
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

test('admin authorization exposes effective session expiry on protected response', async () => {
  const expiresAt = '2026-09-20T10:30:00.000Z';
  const adminAuth = createAdminAuthorization({
    async authenticateRequest() {
      return {
        status: 'success',
        authMethod: 'session',
        sessionId: 12,
        sessionEffectiveExpiresAt: expiresAt,
        user: {
          id: 1,
          username: 'admin',
          isSuperuser: true,
          mustChangePassword: false,
        },
      };
    },
  });
  const req = request();
  const res = response();
  let nextCalled = false;

  await adminAuth.requireProfile(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.adminSessionId, 12);
  assert.equal(req.adminSessionExpiresAt, expiresAt);
  assert.equal(
    res.headers.get('x-dtpstat-admin-session-expires-at'),
    expiresAt,
  );
});

test('admin authorization does not convert permission 403 into session expiry', async () => {
  const adminAuth = createAdminAuthorization({
    async authenticateRequest() {
      return {
        status: 'success',
        authMethod: 'session',
        sessionId: 12,
        sessionEffectiveExpiresAt: '2026-09-20T10:30:00.000Z',
        user: {
          id: 2,
          username: 'viewer',
          isSuperuser: false,
          canManageData: false,
          mustChangePassword: false,
        },
      };
    },
  });
  const req = request();
  const res = response();
  let nextCalled = false;

  await adminAuth.requireData(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(
    res.body?.error,
    'Administrator permission is required',
  );
  assert.equal(
    res.headers.has('x-dtpstat-admin-session-expires-at'),
    false,
  );
});


test('OSM editor permission is independent from broad data management', async () => {
  const adminAuth = createAdminAuthorization({
    async authenticateRequest() {
      return {
        status: 'success',
        authMethod: 'session',
        sessionId: 14,
        sessionEffectiveExpiresAt: '2026-09-20T10:30:00.000Z',
        user: {
          id: 3,
          username: 'osm-editor',
          isSuperuser: false,
          canManageData: false,
          canEditOsm: true,
          mustChangePassword: false,
        },
      };
    },
  });
  const req = request();
  const res = response();
  let osmNext = false;

  await adminAuth.requireOsmEditor(req, res, () => {
    osmNext = true;
  });

  assert.equal(osmNext, true);

  const dataReq = request();
  const dataRes = response();
  let dataNext = false;
  await adminAuth.requireData(dataReq, dataRes, () => {
    dataNext = true;
  });
  assert.equal(dataNext, false);
  assert.equal(dataRes.statusCode, 403);
});
