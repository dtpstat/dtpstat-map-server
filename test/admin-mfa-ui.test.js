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

test('admin login keeps MFA challenge only in page memory and exposes a second step', async () => {
  const [
    html,
    script,
  ] =
    await Promise.all([
      fs.readFile(
        path.join(
          root,
          'admin/login.html',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'admin/login.js',
        ),
        'utf8',
      ),
    ]);

  assert.match(
    html,
    /id="admin-mfa-form" hidden/u,
  );
  assert.match(
    html,
    /autocomplete="one-time-code"/u,
  );
  assert.match(
    script,
    /let mfaChallengeToken = null/u,
  );
  assert.match(
    script,
    /response\.status ===[\s\S]*202[\s\S]*mfaRequired/u,
  );
  assert.match(
    script,
    /\/api\/admin\/login\/mfa/u,
  );
  assert.doesNotMatch(
    script,
    /(?:localStorage|sessionStorage)[\s\S]*mfaChallengeToken/u,
  );
});
