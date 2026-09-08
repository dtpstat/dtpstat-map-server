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
    async updatePassword(_id, _passwordHash, mustChangePassword = false) {
      user = { ...user, mustChangePassword };
      return user;
    },
    async findUserByUsername() { return user; },
    async listUsers() { return user ? [user] : []; },
    async recordSuccessfulLogin() { return user; },
    async recordFailedLogin() { return user; },
    async revokeUserSessions() {},
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
    service.blockUser(1, {}, { id: 2, username: 'operator' }),
    (error) => error instanceof AdminSecurityValidationError && /cannot be manually blocked/.test(error.message),
  );

  const updated = await service.updateUser(1, {
    email: null,
    canManageData: false,
    canManageInterface: false,
    canManageUsers: false,
    canViewAudit: false,
    canManageSecurity: false,
  });
  assert.equal(updated.canManageData, true);
  assert.equal(updated.canManageInterface, true);
  assert.equal(updated.canManageUsers, true);
  assert.equal(updated.canViewAudit, true);
  assert.equal(updated.canManageSecurity, true);
});

test('bootstrap user may still change email and password', async () => {
  const repository = fakeRepository();
  const service = createAdminSecurityService(repository);
  await service.bootstrap({ username: 'admin', password: 'bootstrap-secret' });

  const updated = await service.updateUser(1, {
    email: 'admin@example.test',
  });
  assert.equal(updated.email, 'admin@example.test');

  const passwordReset = await service.resetTemporaryPassword(1);
  assert.equal(passwordReset.user.isBootstrap, true);
  assert.equal(passwordReset.user.mustChangePassword, true);
  assert.match(passwordReset.temporaryPassword, /^[A-Za-z0-9-]+$/);
});
