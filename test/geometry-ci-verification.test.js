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

const read =
  (relativePath) =>
    fs.readFile(
      path.join(
        root,
        relativePath,
      ),
      'utf8',
    );

test('geometry CI verification follows the live migration sequence instead of a hardcoded final version', async () => {
  const [
    packageSource,
    schema,
    upgrade,
    workflow,
  ] =
    await Promise.all([
      read(
        'package.json',
      ),
      read(
        'scripts/verify-geometry-schema-ci.js',
      ),
      read(
        'scripts/verify-geometry-upgrade-ci.js',
      ),
      read(
        '.github/workflows/geometry-editor-check.yml',
      ),
    ]);

  const packageJson =
    JSON.parse(
      packageSource,
    );

  assert.equal(
    packageJson.scripts
      ['test:geometry-schema'],
    'node scripts/verify-geometry-schema-ci.js',
  );
  assert.equal(
    packageJson.scripts
      ['test:geometry-upgrade'],
    'node scripts/verify-geometry-upgrade-ci.js',
  );

  assert.match(
    schema,
    /loadMigrations/u,
  );
  assert.match(
    schema,
    /const expectedVersion =[\s\S]*migrations\.at\(-1\)/u,
  );
  assert.match(
    schema,
    /loadDatabaseSchema/u,
  );
  assert.match(
    schema,
    /geometry_model_integrity/u,
  );
  assert.match(
    schema,
    /assert_no_pending_geometry_import/u,
  );
  assert.doesNotMatch(
    schema,
    /Expected schema version 40/u,
  );

  assert.match(
    upgrade,
    /migration\.name ===[\s\S]*'geometry_editor_role'/u,
  );
  assert.match(
    upgrade,
    /preGeometryVersion/u,
  );
  assert.match(
    upgrade,
    /can_edit_geometries/u,
  );
  assert.match(
    upgrade,
    /effective_city_geometries/u,
  );
  assert.doesNotMatch(
    upgrade,
    /Expected final schema version 40/u,
  );

  assert.match(
    workflow,
    /npm run test:geometry-schema/u,
  );
  assert.match(
    workflow,
    /npm run test:geometry-upgrade/u,
  );
  assert.match(
    workflow,
    /DATABASE_SCHEMA: geometry_ci/u,
  );
  assert.match(
    workflow,
    /DATABASE_SCHEMA: geometry_upgrade_ci/u,
  );
  assert.match(
    workflow,
    /Verify migration idempotence/u,
  );
});
