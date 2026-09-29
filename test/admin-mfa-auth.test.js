import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashAdminPassword,
} from '../src/modules/security/credentials.js';
import {
  createAdminSecurityService,
} from '../src/modules/security/service.js';
import {
  encryptMfaSecret,
  generateTotpSecret,
  mfaChallengeTokenHash,
  totpCode,
} from '../src/modules/security/mfa.js';

const MFA_KEY =
  Buffer.alloc(
    32,
    11,
  ).toString(
    'base64url',
  );

async function fixture() {
  const password =
    'correct horse battery staple';
  const secret =
    generateTotpSecret();
  const user = {
    id: 7,
    username: 'mfa-admin',
    displayName:
      'MFA Admin',
    passwordHash:
      await hashAdminPassword(
        password,
      ),
    isBlocked: false,
    failedLoginCount: 0,
    lockedUntil: null,
    canManageData: true,
    canManageInterface: true,
    canEditOsm: true,
    canEditGeometries: true,
    canManageUsers: true,
    canViewAudit: true,
    canManageSecurity: true,
    isSuperuser: true,
    isBootstrap: false,
    mustChangePassword: false,
  };
  const mfaState = {
    enabled: true,
    secretCiphertext:
      encryptMfaSecret(
        secret,
        MFA_KEY,
      ),
    lastUsedStep: null,
  };
  const challenges =
    new Map();
  const audits = [];
  let successfulLogins = 0;
  let sessions = 0;
  let failedLogins = 0;

  const repository = {
    async isIpBlocked() {
      return null;
    },
    async getIpState() {
      return null;
    },
    async getSecuritySettings() {
      return {
        maxFailedAttempts: 5,
        failureWindowSeconds: 900,
        lockoutSeconds: 900,
        ipMaxFailedAttempts: 20,
        ipFailureWindowSeconds: 900,
        ipLockoutSeconds: 3600,
        sessionAbsoluteSeconds: 3600,
      };
    },
    async findUserByUsername(
      username,
    ) {
      return username ===
        user.username
        ? user
        : null;
    },
    async getAuthUser(
      userId,
    ) {
      return userId ===
        user.id
        ? user
        : null;
    },
    async getMfaState() {
      return mfaState;
    },
    async purgeExpiredMfaChallenges() {},
    async createMfaChallenge(
      value,
    ) {
      challenges.set(
        value
          .tokenHash
          .toString(
            'hex',
          ),
        value,
      );
    },
    async consumeMfaChallenge(
      hash,
    ) {
      const key =
        hash.toString(
          'hex',
        );
      const value =
        challenges.get(
          key,
        ) ??
        null;
      challenges.delete(
        key,
      );
      return value
        ? {
            userId:
              value.userId,
            ipAddress:
              value.ipAddress,
            userAgent:
              value.userAgent,
          }
        : null;
    },
    async advanceMfaStep(
      _userId,
      step,
    ) {
      if (
        mfaState
          .lastUsedStep !==
          null &&
        step <=
          mfaState
            .lastUsedStep
      ) {
        return false;
      }
      mfaState.lastUsedStep =
        step;
      return true;
    },
    async consumeMfaRecoveryCode() {
      return false;
    },
    async clearIpFailures() {},
    async recordSuccessfulLogin() {
      successfulLogins +=
        1;
      return user;
    },
    async recordFailedLogin() {
      failedLogins +=
        1;
      return {
        failedLoginCount:
          failedLogins,
        lockedUntil: null,
      };
    },
    async recordFailedIp() {
      return {
        failedLoginCount: 1,
        lockedUntil: null,
      };
    },
    async createSession() {
      sessions += 1;
      return {
        id: sessions,
      };
    },
    async appendAudit(
      entry,
    ) {
      audits.push(
        entry,
      );
    },
  };

  const service =
    createAdminSecurityService(
      repository,
      {
        mfaEncryptionKey:
          MFA_KEY,
      },
    );

  return {
    service,
    password,
    secret,
    challenges,
    audits,
    counts() {
      return {
        successfulLogins,
        sessions,
        failedLogins,
      };
    },
  };
}

test('MFA-enabled password login creates no session before second factor', async () => {
  const context = {
    ipAddress:
      '127.0.0.1',
    userAgent:
      'test-browser',
  };
  const f =
    await fixture();

  const result =
    await f.service
      .login(
        {
          username:
            'mfa-admin',
          password:
            f.password,
        },
        context,
      );

  assert.equal(
    result.status,
    'mfa-required',
  );
  assert.match(
    result.challengeToken,
    /^[A-Za-z0-9_-]{40,}$/u,
  );
  assert.deepEqual(
    f.counts(),
    {
      successfulLogins: 0,
      sessions: 0,
      failedLogins: 0,
    },
  );
  assert.equal(
    f.challenges.has(
      mfaChallengeTokenHash(
        result
          .challengeToken,
      ).toString(
        'hex',
      ),
    ),
    true,
  );
});

test('MFA challenge completes one normal session and cannot be replayed', async () => {
  const context = {
    ipAddress:
      '127.0.0.1',
    userAgent:
      'test-browser',
  };
  const f =
    await fixture();
  const first =
    await f.service
      .login(
        {
          username:
            'mfa-admin',
          password:
            f.password,
        },
        context,
      );
  const code =
    totpCode(
      f.secret,
    );
  const completed =
    await f.service
      .completeMfaLogin(
        {
          challengeToken:
            first
              .challengeToken,
          code,
        },
        context,
      );

  assert.equal(
    completed.status,
    'success',
  );
  assert.equal(
    completed.user
      .username,
    'mfa-admin',
  );
  assert.deepEqual(
    f.counts(),
    {
      successfulLogins: 1,
      sessions: 1,
      failedLogins: 0,
    },
  );
  assert.equal(
    f.audits.some(
      (entry) =>
        entry.status ===
          'succeeded' &&
        entry.details
          ?.method ===
          'password+totp',
    ),
    true,
  );

  const replay =
    await f.service
      .completeMfaLogin(
        {
          challengeToken:
            first
              .challengeToken,
          code,
        },
        context,
      );
  assert.equal(
    replay.status,
    'invalid-challenge',
  );
});

test('MFA challenge is bound to the password-login client context', async () => {
  const f =
    await fixture();
  const first =
    await f.service
      .login(
        {
          username:
            'mfa-admin',
          password:
            f.password,
        },
        {
          ipAddress:
            '127.0.0.1',
          userAgent:
            'browser-a',
        },
      );

  const result =
    await f.service
      .completeMfaLogin(
        {
          challengeToken:
            first
              .challengeToken,
          code:
            totpCode(
              f.secret,
            ),
        },
        {
          ipAddress:
            '127.0.0.2',
          userAgent:
            'browser-b',
        },
      );

  assert.equal(
    result.status,
    'invalid-challenge',
  );
  assert.equal(
    f.counts()
      .sessions,
    0,
  );
});
