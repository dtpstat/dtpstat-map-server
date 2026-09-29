import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSecurityAdministrationService,
} from '../src/modules/security/admin-service.js';
import {
  normalizeAdminSecuritySettings,
} from '../src/modules/security/policy.js';

function settings(
  overrides = {},
) {
  return {
    maxFailedAttempts: 5,
    failureWindowSeconds: 900,
    lockoutSeconds: 900,
    ipMaxFailedAttempts: 20,
    ipFailureWindowSeconds: 900,
    ipLockoutSeconds: 3600,
    sessionIdleSeconds: 1800,
    sessionAbsoluteSeconds: 43200,
    auditRetentionDays: 365,
    requestRateLimitUserPerMinute: 600,
    requestRateLimitGlobalPerMinute: 5000,
    passwordMinLength: 12,
    passwordMaxLength: 1024,
    passwordRequireLowercase: false,
    passwordRequireUppercase: false,
    passwordRequireDigit: false,
    passwordRequireSpecial: false,
    metricsEnabled: false,
    mfaRequired: false,
    ...overrides,
  };
}

test('security settings normalize the MFA required policy explicitly', () => {
  assert.equal(
    normalizeAdminSecuritySettings(
      settings({
        mfaRequired: true,
      }),
    ).mfaRequired,
    true,
  );
});

test('MFA required policy cannot be enabled without an encryption key', async () => {
  const service =
    createSecurityAdministrationService(
      {
        async getMetricsAccess() {
          return {
            tokenHash: null,
          };
        },
        async saveSecuritySettings() {
          throw new Error(
            'must not persist invalid MFA policy',
          );
        },
      },
      {
        mfaAvailable: false,
      },
    );

  await assert.rejects(
    service.saveSecuritySettings(
      settings({
        mfaRequired: true,
      }),
    ),
    /ADMIN_MFA_ENCRYPTION_KEY/u,
  );
});

test('MFA required policy persists when enrollment is operational', async () => {
  let saved = null;
  const service =
    createSecurityAdministrationService(
      {
        async saveSecuritySettings(
          value,
        ) {
          saved = value;
          return value;
        },
        async purgeAudit() {},
      },
      {
        mfaAvailable: true,
      },
    );

  const result =
    await service.saveSecuritySettings(
      settings({
        mfaRequired: true,
      }),
    );

  assert.equal(
    result.mfaRequired,
    true,
  );
  assert.equal(
    saved.mfaRequired,
    true,
  );
});
