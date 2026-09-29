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

test('profile UI completes the MFA enrollment and recovery lifecycle', async () => {
  const editor =
    await fs.readFile(
      path.join(
        root,
        'admin/profile-editor.js',
      ),
      'utf8',
    );

  assert.match(
    editor,
    /profile-mfa-enroll-form/u,
  );
  assert.match(
    editor,
    /\/api\/admin\/profile\/mfa\/enroll/u,
  );
  assert.match(
    editor,
    /\/api\/admin\/profile\/mfa\/confirm/u,
  );
  assert.match(
    editor,
    /\/api\/admin\/profile\/mfa\/recovery-codes/u,
  );
  assert.match(
    editor,
    /method:\s*'DELETE'[\s\S]*\/api\/admin\/profile\/mfa/u,
  );
  assert.match(
    editor,
    /profile-mfa-recovery-values/u,
  );
  assert.match(
    editor,
    /mfaStatus\?\.required/u,
  );
  assert.match(
    editor,
    /dtpstatReloadAdminSession/u,
  );
  assert.doesNotMatch(
    editor,
    /(?:localStorage|sessionStorage)[\s\S]*(?:mfa|recovery|secret)/iu,
  );
});
