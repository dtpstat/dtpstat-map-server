import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSecurityMfaService,
} from '../src/modules/security/mfa-service.js';

function fixture() {
  let disabled = false;
  let revoked = null;

  const repository = {
    async getAuthUser(
      userId,
    ) {
      return Number(userId) === 7
        ? {
            id: 7,
            username:
              'recover-me',
          }
        : null;
    },
    async getMfaState(
      userId,
    ) {
      return Number(userId) === 7
        ? {
            enabled: true,
          }
        : null;
    },
    async disableMfa(
      userId,
    ) {
      disabled =
        Number(userId) === 7;
      return disabled;
    },
    async revokeUserSessions(
      userId,
      exceptSessionId,
    ) {
      revoked = {
        userId,
        exceptSessionId,
      };
      return 2;
    },
  };

  return {
    service:
      createSecurityMfaService(
        repository,
        {
          async appendAudit() {},
          mfaEncryptionKey:
            null,
        },
      ),
    disabled: () =>
      disabled,
    revoked: () =>
      revoked,
  };
}

test('superuser MFA recovery reset disables target MFA and revokes every target session', async () => {
  const f =
    fixture();

  const result =
    await f.service
      .resetUserMfa(
        7,
        1,
      );

  assert.deepEqual(
    result,
    {
      userId: 7,
      username:
        'recover-me',
      enabled: false,
    },
  );
  assert.equal(
    f.disabled(),
    true,
  );
  assert.deepEqual(
    f.revoked(),
    {
      userId: 7,
      exceptSessionId:
        null,
    },
  );
});

test('administrative MFA reset cannot target the current superuser account', async () => {
  const f =
    fixture();

  await assert.rejects(
    f.service
      .resetUserMfa(
        7,
        7,
      ),
    /cannot reset your own MFA/u,
  );

  assert.equal(
    f.disabled(),
    false,
  );
  assert.equal(
    f.revoked(),
    null,
  );
});

test('administrative MFA reset returns null for an unknown account', async () => {
  const f =
    fixture();

  assert.equal(
    await f.service
      .resetUserMfa(
        999,
        1,
      ),
    null,
  );
});
