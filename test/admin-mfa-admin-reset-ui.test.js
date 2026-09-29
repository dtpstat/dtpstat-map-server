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

test('superuser user-management exposes MFA state and guarded recovery reset', async () => {
  const [
    editor,
    routes,
    contract,
    policy,
  ] =
    await Promise.all([
      fs.readFile(
        path.join(
          root,
          'admin/security-editor-v2.js',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'src/routes/security/user-routes.js',
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
      fs.readFile(
        path.join(
          root,
          'src/modules/security/policy.js',
        ),
        'utf8',
      ),
    ]);

  assert.match(
    policy,
    /mfaEnabled:\s*Boolean/u,
  );
  assert.match(
    editor,
    /user\.mfaEnabled/u,
  );
  assert.match(
    editor,
    /security-user-mfa-reset/u,
  );
  assert.match(
    editor,
    /currentUser\.isSuperuser && user\.mfaEnabled && !isSelf/u,
  );
  assert.match(
    routes,
    /\/admin\/security\/users\/:userId\/mfa/u,
  );
  assert.match(
    routes,
    /adminAuth\.requireSuperuser/u,
  );
  assert.match(
    routes,
    /security\.user\.mfa\.reset/u,
  );
  assert.match(
    contract,
    /'DELETE',[\s\S]*'\/admin\/security\/users\/:userId\/mfa'/u,
  );
});
