import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');

test('city ownership, not geometry boundary activity, drives metrics and public geometry membership', async () => {
  const [recalculate, reports, cities] = await Promise.all([
    read('src/db/recalculate-city-statistics.js'),
    read('src/db/report-config-service.js'),
    read('src/db/cities-repository.js'),
  ]);

  assert.match(recalculate, /geometry\.city_id = city\.id/);
  const geometryStatistics = recalculate.slice(
    recalculate.indexOf('WITH geometry_statistics AS'),
    recalculate.indexOf('boundary_statistics AS'),
  );
  assert.doesNotMatch(geometryStatistics, /boundary\.is_active/);
  assert.match(reports, /LEFT JOIN city_geometries AS geometry\s+ON geometry\.city_id = city\.id/);
  assert.doesNotMatch(reports, /metric_boundary\.id = geometry\.boundary_id/);
  assert.match(cities, /geometry_presence\.city_id = city\.id/);
  assert.doesNotMatch(cities, /geometry_boundary\.id = geometry_presence\.boundary_id/);
  assert.match(cities, /active_boundary\.city_id = geometry\.city_id/);
});

test('database migration enforces deferred boundary/geometry consistency and derived values', async () => {
  const migration = await read('db/migrations/V036__geometry_model_invariants.sql');

  assert.match(migration, /ALTER COLUMN CITY_ID SET NOT NULL/);
  assert.match(migration, /NORMALIZE_CITY_GEOMETRY_DERIVED/);
  assert.match(migration, /ALIGN_ACTIVE_BOUNDARY_GEOMETRIES/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER CITY_BOUNDARIES_CONSISTENCY_CHECK/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER CITY_GEOMETRIES_CONSISTENCY_CHECK/);
  assert.match(migration, /ASSERT_NO_PENDING_GEOMETRY_IMPORT/);
});

test('legacy portable line replacement cannot erase manual edits or non-line geometries', async () => {
  const source = await read('src/db/data-import-service.js');

  assert.doesNotMatch(source, /query\('DELETE FROM city_geometries'\)/);
  assert.match(source, /DELETE_REPLACEABLE_LINES_SQL/);
  assert.match(source, /GeometryType\(geom\) IN \('LINESTRING', 'MULTILINESTRING'\)/);
  assert.match(source, /AND NOT was_edited/);
  assert.match(source, /Legacy line replacement import is blocked because manually edited lines exist/);
  assert.match(source, /COALESCE\(city\.id, boundary\.city_id\)/);
});
