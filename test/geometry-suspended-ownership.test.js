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

test('geometry boundary ownership migration suspends and reattaches durable geometries', async () => {
  const migration =
    await fs.readFile(
      path.join(
        root,
        'db/migrations/V044__suspended_geometry_rebinding.sql',
      ),
      'utf8',
    );

  assert.match(
    migration,
    /RECONCILE_GEOMETRY_BOUNDARY_OWNERSHIP/u,
  );
  assert.match(
    migration,
    /OLD\.IS_ACTIVE[\s\S]*NOT NEW\.IS_ACTIVE/u,
  );
  assert.match(
    migration,
    /SET BOUNDARY_ID = NULL/u,
  );
  assert.match(
    migration,
    /NEW\.IS_ACTIVE[\s\S]*NEW\.CITY_ID IS NOT NULL/u,
  );
  assert.match(
    migration,
    /SET BOUNDARY_ID = NEW\.ID/u,
  );
  assert.match(
    migration,
    /WHERE CITY_ID = NEW\.CITY_ID[\s\S]*BOUNDARY_ID IS NULL/u,
  );
  assert.match(
    migration,
    /ASSERT_CITY_GEOMETRY_INVARIANTS/u,
  );
});
