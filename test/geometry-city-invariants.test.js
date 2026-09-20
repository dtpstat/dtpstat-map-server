import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');

test('schema owns city/boundary/geometry consistency instead of relying only on services', async () => {
  const migration = await read('db/migrations/V036__geometry_city_invariants.sql');

  assert.match(migration, /CITY_BOUNDARIES_CITY_ID_FKEY[\s\S]*ON DELETE SET NULL/);
  assert.match(migration, /CITY_GEOMETRIES_CITY_ID_FKEY[\s\S]*ON DELETE SET NULL/);
  assert.match(migration, /SYNC_GEOMETRY_CITY_FROM_BOUNDARY/);
  assert.match(migration, /PROPAGATE_BOUNDARY_CITY_TO_GEOMETRIES/);
  assert.match(migration, /CREATE OR REPLACE VIEW BUSLANES\.EFFECTIVE_CITY_GEOMETRIES/);
  assert.match(migration, /BOUNDARY\.ID = GEOMETRY\.BOUNDARY_ID/);
  assert.match(migration, /BOUNDARY\.IS_ACTIVE/);
  assert.match(migration, /BOUNDARY\.CITY_ID = GEOMETRY\.CITY_ID/);
  assert.match(migration, /ASSERT_CITY_GEOMETRY_INVARIANTS/);
});

test('all public calculations use the canonical effective geometry view', async () => {
  const [cities, statistics, reports, downloads] = await Promise.all([
    read('src/db/cities-repository.js'),
    read('src/db/recalculate-city-statistics.js'),
    read('src/db/report-config-service.js'),
    read('src/db/public-download-repository.js'),
  ]);

  assert.match(cities, /effective_city_geometries/i);
  assert.doesNotMatch(
    cities,
    /JOIN city_boundaries AS active_boundary\s+ON active_boundary\.city_id = geometry\.city_id/i,
  );
  assert.match(statistics, /LEFT JOIN effective_city_geometries AS geometry/i);
  assert.match(reports, /LEFT JOIN effective_city_geometries AS geometry/i);
  assert.match(reports, /FROM effective_city_geometries AS geometry_presence/i);
  assert.match(downloads, /FROM effective_city_geometries AS geometry/i);
  assert.match(downloads, /FROM effective_city_geometries AS geometry_presence/i);
});

test('geometry merge cannot silently cross OSM ownership boundaries', async () => {
  const repository = await read('src/db/geometry-editor-repository.js');
  assert.match(repository, /geometry\.boundary_id::integer AS "boundaryId"/);
  assert.match(repository, /row\.boundaryId !== first\.boundaryId/);
});
