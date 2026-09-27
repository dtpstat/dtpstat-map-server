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

test('geometry administrative links are optional spatially derived state', async () => {
  const migration =
    await fs.readFile(
      path.join(
        root,
        'db/migrations/V045__spatial_geometry_links.sql',
      ),
      'utf8',
    );

  assert.match(
    migration,
    /DROP TRIGGER IF EXISTS CITY_BOUNDARIES_RECONCILE_GEOMETRIES_UPDATE/u,
  );
  assert.match(
    migration,
    /RESOLVE_GEOMETRY_ADMIN_LINKS/u,
  );
  assert.match(
    migration,
    /ACTIVE_DESCENDANTS/u,
  );
  assert.match(
    migration,
    /ST_DIFFERENCE/u,
  );
  assert.match(
    migration,
    /MATCHED_MEASURE/u,
  );
  assert.match(
    migration,
    /BOUNDARY_ID ASC/u,
  );
  assert.match(
    migration,
    /RELINK_CITY_GEOMETRY/u,
  );
  assert.match(
    migration,
    /RELINK_ALL_CITY_GEOMETRIES/u,
  );
  assert.match(
    migration,
    /CITY_ID IS DISTINCT FROM RESOLVED\.CITY_ID/u,
  );
  assert.doesNotMatch(
    migration,
    /SET[\s\S]{0,180}UPDATED_AT = NOW\(\)[\s\S]{0,180}(?:BOUNDARY_ID|CITY_ID)/u,
  );
  assert.match(
    migration,
    /NULL is a normal editable state/u,
  );
});
