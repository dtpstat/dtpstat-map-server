import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashAdminPassword,
} from '../src/modules/security/credentials.js';
import {
  createSecurityMfaService,
} from '../src/modules/security/mfa-service.js';
import {
  generateTotpSecret,
  recoveryCodeHash,
  totpCode,
} from '../src/modules/security/mfa.js';

const KEY =
  Buffer.alloc(
    32,
    19,
  ).toString(
    'base64url',
  );

async function fixture() {
  const password =
    'mfa-enrollment-password';
  const user = {
    id: 3,
    username:
      'profile-admin',
    passwordHash:
      await hashAdminPassword(
        password,
      ),
  };
  let state = {
    enabled: false,
    secretCiphertext: null,
    pendingSecretCiphertext: null,
    pendingCreatedAt: null,
    lastUsedStep: null,
    enrolledAt: null,
  };
  let recoveryHashes = [];
  let revokedExcept = null;
  const audits = [];

  const repository = {
    async getAuthUser() {
      return user;
    },
    async getMfaState() {
      return state;
    },
    async saveMfaPendingSecret(
      _userId,
      ciphertext,
    ) {
      const pendingCreatedAt =
        new Date()
          .toISOString();
      state = {
        ...state,
        pendingSecretCiphertext:
          ciphertext,
        pendingCreatedAt,
      };
      return {
        pendingCreatedAt,
      };
    },
    async clearMfaPendingSecret() {
      state = {
        ...state,
        pendingSecretCiphertext:
          null,
        pendingCreatedAt:
          null,
      };
      return true;
    },
    async completeMfaEnrollment(
      _userId,
      step,
      hashes,
    ) {
      if (
        !state
          .pendingSecretCiphertext
      ) {
        return null;
      }
      state = {
        ...state,
        enabled: true,
        secretCiphertext:
          state
            .pendingSecretCiphertext,
        pendingSecretCiphertext:
          null,
        pendingCreatedAt:
          null,
        lastUsedStep:
          step,
        enrolledAt:
          new Date()
            .toISOString(),
      };
      recoveryHashes =
        hashes.map(
          (hash) =>
            Buffer.from(
              hash,
            ),
        );
      return {
        enrolledAt:
          state
            .enrolledAt,
      };
    },
    async countUnusedMfaRecoveryCodes() {
      return recoveryHashes
        .length;
    },
    async advanceMfaStep(
      _userId,
      step,
    ) {
      if (
        state.lastUsedStep !==
          null &&
        step <=
          state.lastUsedStep
      ) {
        return false;
      }
      state.lastUsedStep =
        step;
      return true;
    },
    async consumeMfaRecoveryCode(
      _userId,
      hash,
    ) {
      const index =
        recoveryHashes
          .findIndex(
            (candidate) =>
              candidate.equals(
                hash,
              ),
          );
      if (
        index < 0
      ) {
        return false;
      }
      recoveryHashes.splice(
        index,
        1,
      );
      return true;
    },
    async replaceMfaRecoveryCodes(
      _userId,
      hashes,
    ) {
      recoveryHashes =
        hashes.map(
          (hash) =>
            Buffer.from(
              hash,
            ),
        );
    },
    async disableMfa() {
      state = {
        enabled: false,
        secretCiphertext: null,
        pendingSecretCiphertext: null,
        pendingCreatedAt: null,
        lastUsedStep: null,
        enrolledAt: null,
      };
      recoveryHashes =
        [];
      return true;
    },
    async revokeUserSessions(
      _userId,
      exceptSessionId,
    ) {
      revokedExcept =
        exceptSessionId;
      return 1;
    },
  };

  const service =
    createSecurityMfaService(
      repository,
      {
        mfaEncryptionKey:
          KEY,
        async appendAudit(
          entry,
        ) {
          audits.push(
            entry,
          );
        },
      },
    );

  return {
    service,
    password,
    state: () =>
      state,
    recoveryHashes: () =>
      recoveryHashes,
    revokedExcept: () =>
      revokedExcept,
    audits,
  };
}

test('MFA profile enrollment requires the current password and confirms a TOTP before enabling', async () => {
  const f =
    await fixture();

  await assert.rejects(
    f.service
      .beginMfaEnrollment(
        3,
        {
          currentPassword:
            'wrong',
        },
      ),
    /Current password is incorrect/u,
  );

  const enrollment =
    await f.service
      .beginMfaEnrollment(
        3,
        {
          currentPassword:
            f.password,
        },
      );

  assert.match(
    enrollment.secret,
    /^[A-Z2-7]+$/u,
  );
  assert.match(
    enrollment
      .provisioningUri,
    /^otpauth:\/\/totp\//u,
  );
  assert.equal(
    f.state()
      .enabled,
    false,
  );

  const code =
    totpCode(
      enrollment
        .secret,
    );
  const confirmed =
    await f.service
      .confirmMfaEnrollment(
        3,
        {
          code,
        },
        44,
      );

  assert.equal(
    confirmed.enabled,
    true,
  );
  assert.equal(
    confirmed
      .recoveryCodes
      .length,
    10,
  );
  assert.equal(
    f.state()
      .enabled,
    true,
  );
  assert.equal(
    f.recoveryHashes()
      .length,
    10,
  );
  assert.equal(
    f.revokedExcept(),
    44,
  );
});

test('MFA status never exposes encrypted or plaintext secrets', async () => {
  const f =
    await fixture();
  const status =
    await f.service
      .getMfaStatus(
        3,
      );

  assert.deepEqual(
    Object.keys(
      status,
    ).sort(),
    [
      'available',
      'enabled',
      'enrolledAt',
      'enrollmentPending',
      'recoveryCodesRemaining',
    ],
  );
});

test('MFA recovery rotation and disable require password plus a valid second factor', async () => {
  const f =
    await fixture();
  const enrollment =
    await f.service
      .beginMfaEnrollment(
        3,
        {
          currentPassword:
            f.password,
        },
      );
  await f.service
    .confirmMfaEnrollment(
      3,
      {
        code:
          totpCode(
            enrollment
              .secret,
          ),
      },
      1,
    );

  const before =
    f.recoveryHashes()
      .map(
        (hash) =>
          hash.toString(
            'hex',
          ),
      );

  const recoveryCode =
    generateTotpSecret()
      .slice(
        0,
        16,
      )
      .match(
        /.{4}/gu,
      )
      .join(
        '-',
      );
  f.recoveryHashes()
    .push(
      recoveryCodeHash(
        recoveryCode,
      ),
    );

  const rotated =
    await f.service
      .regenerateMfaRecoveryCodes(
        3,
        {
          currentPassword:
            f.password,
          code:
            recoveryCode,
        },
      );

  assert.equal(
    rotated
      .recoveryCodes
      .length,
    10,
  );
  assert.notDeepEqual(
    f.recoveryHashes()
      .map(
        (hash) =>
          hash.toString(
            'hex',
          ),
      ),
    before,
  );

  const disableCode =
    totpCode(
      enrollment
        .secret,
      {
        timestampMs:
          Date.now() +
          30_000,
      },
    );
  const disabled =
    await f.service
      .disableOwnMfa(
        3,
        {
          currentPassword:
            f.password,
          code:
            disableCode,
        },
        55,
      );

  assert.equal(
    disabled.enabled,
    false,
  );
  assert.equal(
    f.state()
      .enabled,
    false,
  );
  assert.equal(
    f.revokedExcept(),
    55,
  );
});
