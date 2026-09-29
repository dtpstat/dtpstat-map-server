import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';

const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );

test('mandatory MFA uses profile-only enrollment mode instead of login lockout', async () => {
  const [
    auth,
    migration,
    contract,
  ] =
    await Promise.all([
      fs.readFile(
        path.join(
          root,
          'src/http/admin-auth.js',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'db/migrations/V056__admin_mfa_policy.sql',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'src/http/api-request-contract.js',
        ),
        'utf8',
      ),
    ]);

  assert.match(
    migration,
    /MFA_REQUIRED BOOLEAN NOT NULL DEFAULT FALSE/u,
  );
  assert.match(
    auth,
    /securitySettings[\s\S]*mfaRequired[\s\S]*!user\.mfaEnabled/u,
  );
  assert.match(
    auth,
    /allowMfaEnrollmentPending:\s*true/u,
  );
  assert.match(
    auth,
    /mfa_enrollment_required/u,
  );
  assert.match(
    auth,
    /mfa-enrollment-required/u,
  );
  assert.match(
    contract,
    /'mfaRequired'/u,
  );
});
