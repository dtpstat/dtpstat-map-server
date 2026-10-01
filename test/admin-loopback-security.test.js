import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  createAdminAuthorization,
} from '../src/http/admin-auth.js';
import {
  isLoopbackClientIp,
  requestClientIp,
} from '../src/shared/http/client-ip.js';
import {
  createSecurityAdministrationService,
} from '../src/modules/security/admin-service.js';
import {
  createSecurityAuthService,
} from '../src/modules/security/auth-service.js';
import {
  isLoopbackAdminIp,
} from '../src/modules/security/policy.js';

function response() {
  const emitter =
    new EventEmitter();

  return Object.assign(
    emitter,
    {
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
      redirect(status, location) {
        this.statusCode =
          status;
        this.headers.set(
          'location',
          location,
        );
        return this;
      },
    },
  );
}

function request(
  overrides = {},
) {
  return {
    method: 'GET',
    path:
      '/api/admin/project-settings',
    originalUrl:
      '/api/admin/project-settings',
    protocol: 'https',
    headers: {},
    query: {},
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

test('loopback helpers recognize IPv4 IPv6 and mapped IPv4 without trusting socket over request.ip', () => {
  for (
    const value of [
      '127.0.0.1',
      '127.0.0.2',
      '::1',
      '::ffff:127.0.0.1',
    ]
  ) {
    assert.equal(
      isLoopbackClientIp(value),
      true,
    );
    assert.equal(
      isLoopbackAdminIp(value),
      true,
    );
  }

  assert.equal(
    isLoopbackClientIp(
      '192.168.0.1',
    ),
    false,
  );
  assert.equal(
    isLoopbackAdminIp(
      '203.0.113.10',
    ),
    false,
  );

  const proxied =
    request({
      ip: '203.0.113.10',
      socket: {
        remoteAddress:
          '127.0.0.1',
      },
    });

  assert.equal(
    requestClientIp(
      proxied,
    ),
    '203.0.113.10',
  );
  assert.equal(
    isLoopbackClientIp(
      requestClientIp(
        proxied,
      ),
    ),
    false,
  );
});

test('loopback skips persisted IP block and request-security incident state', async () => {
  const repositoryCalls =
    [];
  const repository = {
    async isIpBlocked(ip) {
      repositoryCalls.push([
        'isIpBlocked',
        ip,
      ]);
      return {
        id: 1,
      };
    },
    async getIpState(ip) {
      repositoryCalls.push([
        'getIpState',
        ip,
      ]);
      return {
        lockedUntil:
          '2099-01-01T00:00:00.000Z',
      };
    },
    async getSecuritySettings() {
      repositoryCalls.push([
        'getSecuritySettings',
      ]);
      return {};
    },
    async recordRequestSecurityIncident(
      ip,
    ) {
      repositoryCalls.push([
        'recordRequestSecurityIncident',
        ip,
      ]);
      return {
        requestLockedUntil:
          '2099-01-01T00:00:00.000Z',
      };
    },
  };
  const audits = [];
  const service =
    createSecurityAuthService(
      repository,
      {
        async appendAudit(entry) {
          audits.push(entry);
        },
      },
    );

  assert.deepEqual(
    await service.ipAccessState(
      '127.0.0.1',
    ),
    {
      status: 'ok',
      ipAddress: '127.0.0.1',
      loopback: true,
    },
  );

  assert.deepEqual(
    await service.ipAccessState(
      '::1',
    ),
    {
      status: 'ok',
      ipAddress: '::1',
      loopback: true,
    },
  );

  const incident =
    await service
      .recordRequestSecurityIncident(
        '127.0.0.1',
        {
          reason:
            'api-contract',
        },
      );

  assert.equal(
    incident.locked,
    false,
  );
  assert.equal(
    incident.loopback,
    true,
  );
  assert.deepEqual(
    repositoryCalls,
    [],
  );
  assert.deepEqual(
    audits,
    [],
  );
});

test('manual IP administration rejects loopback blocks', async () => {
  let writes = 0;
  const service =
    createSecurityAdministrationService({
      async createIpBlock() {
        writes += 1;
        return {
          id: 1,
        };
      },
    });

  for (
    const ipAddress of [
      '127.0.0.1',
      '127.0.0.9',
      '::1',
      '::ffff:127.0.0.1',
    ]
  ) {
    await assert.rejects(
      service.createIpBlock(
        {
          ipAddress,
        },
        {
          id: 7,
        },
        '203.0.113.10',
      ),
      /Loopback IP addresses cannot be blocked/u,
    );
  }

  assert.equal(
    writes,
    0,
  );
});

test('loopback admin requests do not consume global or per-user rate budgets', async () => {
  let globalConsumes = 0;
  let userConsumes = 0;
  let settingsReads = 0;
  const requestRateLimiter = {
    consumeGlobal() {
      globalConsumes += 1;
      return {
        allowed: false,
        scope: 'global',
        limit: 1,
        retryAfterSeconds: 60,
      };
    },
    consumeUser() {
      userConsumes += 1;
      return {
        allowed: false,
        scope: 'user',
        limit: 1,
        retryAfterSeconds: 60,
      };
    },
  };

  const securityService = {
    async getSecuritySettings() {
      settingsReads += 1;
      return {
        requestRateLimitUserPerMinute:
          1,
        requestRateLimitGlobalPerMinute:
          1,
      };
    },
    async authenticateRequest() {
      return {
        status: 'success',
        user: {
          id: 7,
          username:
            'operator',
          canManageInterface:
            true,
          canManageData:
            true,
          canEditOsm:
            true,
          canEditGeometries:
            true,
          canManageUsers:
            true,
          canViewAudit:
            true,
          canManageSecurity:
            true,
          isSuperuser:
            true,
          mustChangePassword:
            false,
          mfaEnabled:
            true,
        },
        securitySettings: {
          mfaRequired:
            false,
        },
        authMethod:
          'session',
        sessionId: 9,
        sessionEffectiveExpiresAt:
          '2099-01-01T00:00:00.000Z',
      };
    },
    async appendAudit() {},
  };

  const adminAuth =
    createAdminAuthorization(
      securityService,
      {
        requestRateLimiter,
      },
    );

  let globalNext = 0;
  await adminAuth
    .limitGlobalRequest(
      request(),
      response(),
      () => {
        globalNext += 1;
      },
    );

  assert.equal(
    globalNext,
    1,
  );
  assert.equal(
    globalConsumes,
    0,
  );
  assert.equal(
    settingsReads,
    0,
  );

  let userNext = 0;
  const req =
    request({
      headers: {
        cookie:
          'dtpstat_admin_session=test',
      },
    });
  const res =
    response();

  await adminAuth
    .requireAny(
      req,
      res,
      () => {
        userNext += 1;
      },
    );

  assert.equal(
    userNext,
    1,
  );
  assert.equal(
    userConsumes,
    0,
  );
});

test('trusted proxy client IP still consumes rate budgets even when the proxy socket is loopback', async () => {
  let globalConsumes = 0;
  const requestRateLimiter = {
    consumeGlobal() {
      globalConsumes += 1;
      return {
        allowed: true,
        scope: 'global',
        limit: 20,
        retryAfterSeconds: 0,
      };
    },
    consumeUser() {
      return {
        allowed: true,
        scope: 'user',
        limit: 10,
        retryAfterSeconds: 0,
      };
    },
  };

  const adminAuth =
    createAdminAuthorization(
      {
        async getSecuritySettings() {
          return {
            requestRateLimitGlobalPerMinute:
              20,
          };
        },
      },
      {
        requestRateLimiter,
      },
    );

  let nextCalled = 0;
  await adminAuth
    .limitGlobalRequest(
      request({
        ip:
          '203.0.113.10',
        socket: {
          remoteAddress:
            '127.0.0.1',
        },
      }),
      response(),
      () => {
        nextCalled += 1;
      },
    );

  assert.equal(
    nextCalled,
    1,
  );
  assert.equal(
    globalConsumes,
    1,
  );
});
