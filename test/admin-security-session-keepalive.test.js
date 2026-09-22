import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminSecurityService } from '../src/data/admin-security.js';

function sessionRepository({ idleSeconds, lastSeenAt }) {
  const touched = [];
  return {
    touched,
    async isIpBlocked() { return null; },
    async getIpState() { return null; },
    async findSession() {
      return {
        sessionId: 42,
        sessionLastSeenAt: lastSeenAt,
        sessionExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        id: 1,
        username: 'admin',
        displayName: 'Admin',
        isSuperuser: true,
        isBootstrap: true,
        isBlocked: false,
        mustChangePassword: false,
      };
    },
    async getSecuritySettings() {
      return {
        sessionIdleSeconds: idleSeconds,
        sessionAbsoluteSeconds: 3600,
      };
    },
    async touchSession(sessionId, timestamp) {
      touched.push({ sessionId, timestamp });
    },
    async revokeSessionByHash() {},
    async appendAudit() {},
  };
}

test('minimum 60 second idle timeout is touched after half the idle window', async () => {
  const repository = sessionRepository({
    idleSeconds: 60,
    lastSeenAt: new Date(Date.now() - 31_000).toISOString(),
  });
  const service = createAdminSecurityService(repository);

  const result = await service.authenticateRequest({
    authorization: null,
    sessionToken: 'test-session-token',
    ipAddress: null,
    userAgent: 'test',
  });

  assert.equal(result.status, 'success');
  assert.equal(repository.touched.length, 1);
  assert.equal(repository.touched[0].sessionId, 42);
  assert.ok(
    Date.parse(result.sessionIdleExpiresAt) >= Date.now() + 59_000,
  );
});

test('longer idle timeouts keep the one-minute write throttle', async () => {
  const repository = sessionRepository({
    idleSeconds: 600,
    lastSeenAt: new Date(Date.now() - 31_000).toISOString(),
  });
  const service = createAdminSecurityService(repository);

  const result = await service.authenticateRequest({
    authorization: null,
    sessionToken: 'test-session-token',
    ipAddress: null,
    userAgent: 'test',
  });

  assert.equal(result.status, 'success');
  assert.equal(repository.touched.length, 0);
});
