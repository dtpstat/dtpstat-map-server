import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  AdminSecurityValidationError,
} from '../src/modules/security/policy.js';
import {
  createSecurityAdministrationService,
} from '../src/modules/security/admin-service.js';

function baseSettings(
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
    metricsTokenConfigured: false,
    ...overrides,
  };
}

function repository() {
  let tokenHash = null;
  let enabled = false;
  let initialized = false;

  return {
    async getSecuritySettings() {
      return baseSettings({
        metricsEnabled:
          enabled,
        metricsTokenConfigured:
          Buffer.isBuffer(
            tokenHash,
          ),
      });
    },
    async saveSecuritySettings(
      settings,
    ) {
      enabled =
        settings
          .metricsEnabled;
      return baseSettings({
        ...settings,
        metricsTokenConfigured:
          Buffer.isBuffer(
            tokenHash,
          ),
      });
    },
    async purgeAudit() {},
    async getMetricsAccess() {
      return {
        enabled,
        tokenHash,
        initialized,
      };
    },
    async initializeMetricsSettings(
      value,
    ) {
      if (!initialized) {
        enabled =
          value.enabled;
        tokenHash =
          value.tokenHash;
        initialized =
          true;
        return {
          enabled,
          tokenHash,
          initialized,
          initializedFromEnvironment:
            true,
        };
      }
      return {
        enabled,
        tokenHash,
        initialized,
        initializedFromEnvironment:
          false,
      };
    },
    async saveMetricsTokenHash(
      value,
    ) {
      tokenHash =
        value;
      initialized =
        true;
      return this
        .getSecuritySettings();
    },
    async clearMetricsToken() {
      enabled =
        false;
      tokenHash =
        null;
      initialized =
        true;
      return this
        .getSecuritySettings();
    },
  };
}

test('metrics bootstrap hashes the environment token exactly once', async () => {
  const repo =
    repository();
  const service =
    createSecurityAdministrationService(
      repo,
    );
  const token =
    '0123456789abcdef0123456789abcdef';

  const first =
    await service
      .bootstrapMetricsSettings({
        enabled: true,
        bearerToken:
          token,
      });
  const second =
    await service
      .bootstrapMetricsSettings({
        enabled: false,
        bearerToken: null,
      });

  assert.deepEqual(
    first,
    {
      initializedFromEnvironment:
        true,
      enabled: true,
      tokenConfigured: true,
    },
  );
  assert.equal(
    second
      .initializedFromEnvironment,
    false,
  );
  assert.equal(
    second.enabled,
    true,
  );

  const access =
    await repo
      .getMetricsAccess();
  assert.equal(
    access
      .tokenHash
      .equals(
        crypto
          .createHash(
            'sha256',
          )
          .update(
            token,
            'utf8',
          )
          .digest(),
      ),
    true,
  );
  assert.equal(
    access
      .tokenHash
      .includes(
        Buffer.from(
          token,
        ),
      ),
    false,
  );
});

test('metrics cannot be enabled before a token is configured', async () => {
  const service =
    createSecurityAdministrationService(
      repository(),
    );

  await assert.rejects(
    service
      .saveSecuritySettings(
        baseSettings({
          metricsEnabled:
            true,
        }),
      ),
    (error) =>
      error instanceof
        AdminSecurityValidationError &&
      /Prometheus bearer token/u
        .test(
          error.message,
        ),
  );
});

test('metrics token rotation returns plaintext once and authorization uses only its hash', async () => {
  const service =
    createSecurityAdministrationService(
      repository(),
    );
  const rotated =
    await service
      .rotateMetricsToken();

  assert.match(
    rotated.token,
    /^[A-Za-z0-9_-]{40,}$/u,
  );
  assert.equal(
    rotated.settings
      .metricsTokenConfigured,
    true,
  );

  await service
    .saveSecuritySettings(
      baseSettings({
        metricsEnabled:
          true,
        metricsTokenConfigured:
          true,
      }),
    );

  assert.deepEqual(
    await service
      .authorizeMetricsToken(
        rotated.token,
      ),
    {
      enabled: true,
      authorized: true,
    },
  );
  assert.deepEqual(
    await service
      .authorizeMetricsToken(
        'wrong-token',
      ),
    {
      enabled: true,
      authorized: false,
    },
  );

  const cleared =
    await service
      .clearMetricsToken();
  assert.equal(
    cleared.metricsEnabled,
    false,
  );
  assert.equal(
    cleared
      .metricsTokenConfigured,
    false,
  );
});
