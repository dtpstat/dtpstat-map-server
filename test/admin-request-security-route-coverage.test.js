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

test('admin JSON routes use the common request body security guard', async () => {
  const [
    shared,
    adminJson,
  ] =
    await Promise.all([
      fs.readFile(
        path.join(
          root,
          'src/shared/http/express.js',
        ),
        'utf8',
      ),
      fs.readFile(
        path.join(
          root,
          'src/http/admin-json-body.js',
        ),
        'utf8',
      ),
    ]);

  assert.doesNotMatch(
    shared,
    /adminJsonBodySecurityGuard/u,
  );
  assert.match(
    shared,
    /verifyNoDuplicateJsonKeys/u,
  );
  assert.match(
    adminJson,
    /adminJsonBodySecurityGuard/u,
  );

  for (
    const relativePath of [
      'src/routes/admin-security-api.js',
      'src/routes/geometry-editor-api.js',
      'src/routes/line-types-api.js',
      'src/routes/osm-boundaries-api.js',
      'src/routes/project-settings-api.js',
      'src/routes/report-config-api.js',
      'src/routes/project/transfer-import-routes.js',
    ]
  ) {
    const source =
      await fs.readFile(
        path.join(
          root,
          relativePath,
        ),
        'utf8',
      );

    assert.doesNotMatch(
      source,
      /express\.json\(/u,
      relativePath,
    );
    assert.match(
      source,
      /jsonBody|createJsonBody/u,
      relativePath,
    );
  }
});
