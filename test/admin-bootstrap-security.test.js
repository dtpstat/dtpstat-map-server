import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminSecurityValidationError,
  createAdminSecurityService,
} from '../src/data/admin-security.js';

function fakeRepository() {
  let user = null;
  return {
    async countUsers() { return user ? 1 : 0; },
    async createUser(payload) {
      user = {
        id: 1,
        ...payload,
        isBlocked: false,
        failedLoginCount: 0,
        failedLoginWindowStartedAt: null,
        lockedUntil: null,
      };
      return user;
    },
    async getUser() { return user; },
    async updateUser(_id, payload) {
      user = { ...user, ...payload };
      return user;
    },
    async updatePassword() { return user; },
    async findUserByUsername() { return user; },
    async listUsers() { return user ? [user] : []; },
    async recordSuccessfulLogin() { return user; },
    async recordFailedLogin() { return user; },
    async getSecuritySettings() {
      return {
        maxFailedAttempts: 5,
        failureWindowSeconds: 900,
        lockoutSeconds: 900,
      };
    },
    async saveSecuritySettings(settings) { return settings; },
    async appendAudit() {},
    async listAudit() { return []; },
  };
}

test('first environment user is marked as the protected bootstrap superuser', async () => {
  const service = createAdminSecurityService(fakeRepository());
  const result = await service.bootstrap({ username: 'admin', password: 'bootstrap-secret' });

  assert.equal(result.created, true);
  assert.equal(result.user.username, 'admin');
  assert.equal(result.user.isSuperuser, true);
  assert.equal(result.user.isBootstrap, true);
  assert.equal(result.user.canManageData, true);
  assert.equal(result.user.canManageInterface, true);
  assert.equal(result.user.isBlocked, false);
});

test('bootstrap user cannot be manually blocked or stripped of permissions', async () => {
  const service = createAdminSecurityService(fakeRepository());
  await service.bootstrap({ username: 'admin', password: 'bootstrap-secret' });

  await assert.rejects(
    service.updateUser(1, {
      email: null,
      canManageData: true,
      canManageInterface: true,
      isBlocked: true,
    }),
    (error) => error instanceof AdminSecurityValidationError && /cannot be manually blocked/.test(error.message),
  );

  await assert.rejects(
    service.updateUser(1, {
      email: null,
      canManageData: false,
      canManageInterface: true,
      isBlocked: false,
    }),
    (error) => error instanceof AdminSecurityValidationError && /retain both/.test(error.message),
  );
});

test('bootstrap user may still change email and password', async () => {
  const repository = fakeRepository();
  const service = createAdminSecurityService(repository);
  await service.bootstrap({ username: 'admin', password: 'bootstrap-secret' });

  const updated = await service.updateUser(1, {
    email: 'admin@example.test',
    canManageData: true,
    canManageInterface: true,
    isBlocked: false,
  });
  assert.equal(updated.email, 'admin@example.test');

  const passwordChanged = await service.changePassword(1, {
    password: 'another-long-password',
  });
  assert.equal(passwordChanged.isBootstrap, true);
});
