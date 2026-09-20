import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');

test('effective geometry membership is owned by the exact active OSM boundary', async () => {
  const [recalculate, reports, cities, transfer] = await Promise.all([
    read('src/db/recalculate-city-statistics.js'),
    read('src/db/report-config-service.js'),
    read('src/db/cities-repository.js'),
    read('src/db/project-settings-transfer-service.js'),
  ]);

  assert.match(recalculate, /effective_city_geometries/i);
  assert.match(reports, /effective_city_geometries/i);
  assert.match(cities, /effective_city_geometries/i);
  assert.match(transfer, /effective_city_geometries/i);

  assert.doesNotMatch(
    cities,
    /active_boundary\.city_id = geometry\.city_id/,
  );
});

test('historical V036 keeps derived-value normalization and V038 defines final ownership', async () => {
  const [legacy, finalMigration] = await Promise.all([
    read('db/migrations/V036__geometry_model_invariants.sql'),
    read('db/migrations/V038__effective_geometry_ownership.sql'),
  ]);

  assert.match(legacy, /NORMALIZE_CITY_GEOMETRY_DERIVED/);
  assert.match(finalMigration, /ALTER COLUMN CITY_ID DROP NOT NULL/);
  assert.match(finalMigration, /ON DELETE SET NULL/);
  assert.match(finalMigration, /EFFECTIVE_CITY_GEOMETRIES/);
  assert.match(finalMigration, /SYNC_GEOMETRY_CITY_FROM_BOUNDARY/);
  assert.match(finalMigration, /PROPAGATE_BOUNDARY_CITY_TO_GEOMETRIES/);
});

test('legacy portable line replacement cannot erase manual edits or non-line geometries', async () => {
  const source = await read('src/db/data-import-service.js');

  assert.doesNotMatch(source, /query\('DELETE FROM city_geometries'\)/);
  assert.match(source, /DELETE_REPLACEABLE_LINES_SQL/);
  assert.match(source, /GeometryType\(geom\) IN \('LINESTRING', 'MULTILINESTRING'\)/);
  assert.match(source, /AND NOT was_edited/);
  assert.match(source, /Legacy line replacement import is blocked because manually edited lines exist/);
});
