import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  adminJsonBodySecurityGuard,
  detectAdminBodyTampering,
  detectAdminTransportTampering,
  installAdminRequestSecurityContext,
} from '../src/http/admin-request-security.js';

function response() {
  const emitter =
    new EventEmitter();

  return Object.assign(
    emitter,
    {
      statusCode: 200,
      body: null,
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
    method: 'POST',
    path:
      '/api/admin/geometry-editor/sync',
    originalUrl:
      '/api/admin/geometry-editor/sync',
    headers: {},
    query: {},
    socket: {
      remoteAddress:
        '127.0.0.1',
    },
    ...overrides,
  };
}

test('admin transport guard detects identity and role assertions without values', () => {
  const findings =
    detectAdminTransportTampering(
      request({
        headers: {
          'x-admin-user-id':
            '999',
          'x-rolemode':
            'superuser',
        },
        query: {
          UserID: '999',
          RoleIR: 'root',
          ToleIR: 'legacy-root',
          role_mode:
            'override',
        },
      }),
    );

  assert.deepEqual(
    findings,
    [
      {
        source: 'header',
        key:
          'x-admin-user-id',
      },
      {
        source: 'header',
        key:
          'x-rolemode',
      },
      {
        source: 'query',
        key: 'UserID',
      },
      {
        source: 'query',
        key: 'RoleIR',
      },
      {
        source: 'query',
        key: 'ToleIR',
      },
      {
        source: 'query',
        key:
          'role_mode',
      },
    ],
  );
});

test('admin body guard rejects server-owned security attributes', async () => {
  const req =
    request({
      body: {
        displayName:
          'test',
        userId: 999,
        isSuperuser:
          true,
        roleMode:
          'root',
        canManageSecurity:
          true,
      },
    });

  assert.deepEqual(
    detectAdminBodyTampering(
      req,
    ).map(
      (item) =>
        item.key,
    ),
    [
      'userId',
      'isSuperuser',
      'roleMode',
      'canManageSecurity',
    ],
  );

  const res =
    response();
  let nextCalled =
    false;

  await adminJsonBodySecurityGuard(
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
});

test('user administration may set capability flags but never immutable identity attributes', () => {
  const allowed =
    request({
      path:
        '/admin/security/users/12',
      originalUrl:
        '/api/admin/security/users/12',
      method: 'PATCH',
      body: {
        canManageData:
          true,
        canManageSecurity:
          true,
      },
    });

  assert.deepEqual(
    detectAdminBodyTampering(
      allowed,
    ),
    [],
  );

  allowed.body = {
    canManageData: true,
    userId: 1,
    isSuperuser: true,
    isBootstrap: true,
    roleId: 9,
    roleMode:
      'override',
  };

  assert.deepEqual(
    detectAdminBodyTampering(
      allowed,
    ).map(
      (item) =>
        item.key,
    ),
    [
      'userId',
      'isSuperuser',
      'isBootstrap',
      'roleId',
      'roleMode',
    ],
  );
});

test('rejected authenticated requests are written to security audit', async () => {
  const req =
    request();
  const res =
    response();
  const logs = [];
  const audits = [];

  installAdminRequestSecurityContext(
    req,
    res,
    {
      user: {
        id: 7,
        username:
          'operator',
      },
      securityService: {
        async appendAudit(
          entry,
        ) {
          audits.push(
            entry,
          );
        },
      },
      log(
        event,
        details,
      ) {
        logs.push({
          event,
          details,
        });
      },
    },
  );

  res.statusCode = 400;
  res.emit('finish');

  await new Promise(
    (resolve) =>
      setImmediate(
        resolve,
      ),
  );

  assert.equal(
    logs[0].event,
    'admin.request.rejected',
  );
  assert.equal(
    logs[0].details.userId,
    7,
  );
  assert.equal(
    audits[0].operationType,
    'admin.request.rejected',
  );
  assert.equal(
    audits[0].status,
    'failed',
  );
});
