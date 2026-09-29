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

test('password login handles MFA challenge states before generic authentication failure', async () => {
  const source =
    await fs.readFile(
      path.join(
        root,
        'src/routes/security/profile-routes.js',
      ),
      'utf8',
    );

  const required =
    source.indexOf(
      "result.status ===\n          'mfa-required'",
    );
  const unavailable =
    source.indexOf(
      "result.status ===\n          'mfa-unavailable'",
    );
  const generic =
    source.indexOf(
      "result.status !==\n          'success'",
    );

  assert.ok(
    required >= 0 &&
    unavailable >= 0 &&
    generic >= 0,
  );
  assert.ok(
    required <
      generic,
  );
  assert.ok(
    unavailable <
      generic,
  );
  assert.match(
    source,
    /result\.status ===[\s\S]*'mfa-required'[\s\S]*\.status\(202\)/u,
  );
});
