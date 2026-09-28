import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';
import {
  normalizeAdminSecuritySettings,
} from '../src/modules/security/policy.js';

const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );

function payload() {
  return {
    maxFailedAttempts: 5,
    failureWindowSeconds: 900,
    lockoutSeconds: 1800,
    ipMaxFailedAttempts: 20,
    ipFailureWindowSeconds: 900,
    ipLockoutSeconds: 3600,
    sessionIdleSeconds: 1800,
    sessionAbsoluteSeconds: 43200,
    auditRetentionDays: 365,
    requestRateLimitUserPerMinute: 600,
    requestRateLimitGlobalPerMinute: 5000,
    passwordMinLength: 12,
    passwordMaxLength: 256,
    passwordRequireLowercase: true,
    passwordRequireUppercase: true,
    passwordRequireDigit: true,
    passwordRequireSpecial: true,
  };
}

test('admin security settings validate user and global request limits', () => {
  const normalized =
    normalizeAdminSecuritySettings(
      payload(),
    );

  assert.equal(
    normalized
      .requestRateLimitUserPerMinute,
    600,
  );
  assert.equal(
    normalized
      .requestRateLimitGlobalPerMinute,
    5000,
  );

  assert.throws(
    () =>
      normalizeAdminSecuritySettings({
        ...payload(),
        requestRateLimitUserPerMinute: 700,
        requestRateLimitGlobalPerMinute: 600,
      }),
    /must not be lower/u,
  );
});

test('admin request rate settings are persisted and exposed in security GUI', async () => {
  const [
    migration,
    repository,
    ui,
  ] =
    await Promise.all([
      fs.readFile(
        path.join(
          root,
          'db/migrations/V047__admin_request_security.sql',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'src/db/admin-access-control-repository.js',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'admin/security-editor-v2.js',
        ),
        'utf8',
      ),
    ]);

  assert.match(
    migration,
    /REQUEST_RATE_LIMIT_USER_PER_MINUTE/u,
  );
  assert.match(
    migration,
    /REQUEST_RATE_LIMIT_GLOBAL_PER_MINUTE/u,
  );
  assert.match(
    repository,
    /requestRateLimitUserPerMinute/u,
  );
  assert.match(
    repository,
    /requestRateLimitGlobalPerMinute/u,
  );
  assert.match(
    ui,
    /name="requestRateLimitUserPerMinute"/u,
  );
  assert.match(
    ui,
    /name="requestRateLimitGlobalPerMinute"/u,
  );
});
