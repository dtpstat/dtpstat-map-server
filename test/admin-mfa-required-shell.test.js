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

test('mandatory MFA policy restricts the admin shell to profile enrollment', async () => {
  const [
    securityEditor,
    shell,
    sessionHttp,
    profileRoutes,
  ] =
    await Promise.all([
      fs.readFile(
        path.join(root, 'admin/security-editor-v2.js'),
        'utf8',
      ),
      fs.readFile(
        path.join(root, 'admin/admin-shell.js'),
        'utf8',
      ),
      fs.readFile(
        path.join(root, 'src/http/admin-session-http.js'),
        'utf8',
      ),
      fs.readFile(
        path.join(root, 'src/routes/security/profile-routes.js'),
        'utf8',
      ),
    ]);

  assert.match(
    securityEditor,
    /name="mfaRequired"/u,
  );
  assert.match(
    shell,
    /mfaRequired &&[\s\S]*!user\.mfaEnabled/u,
  );
  assert.match(
    shell,
    /const initial = restricted[\s\S]*'profile'/u,
  );
  assert.match(
    shell,
    /session\.mfaRequired/u,
  );
  assert.match(
    sessionHttp,
    /request\.adminSecuritySettings/u,
  );
  assert.match(
    profileRoutes,
    /mfaRequired:[\s\S]*adminSecuritySettings/u,
  );
});
