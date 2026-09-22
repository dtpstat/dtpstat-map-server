import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('V037 preserves detached legacy geometries instead of requiring CITY_ID', async () => {
  const source = await fs.readFile(
    path.join(root, 'db/migrations/V037__geometry_model_invariants.sql'),
    'utf8',
  );

  assert.doesNotMatch(source, /ALTER COLUMN CITY_ID SET NOT NULL/);
  assert.doesNotMatch(source, /Cannot enforce geometry ownership/);
  assert.match(source, /CITY_ID intentionally remains nullable/);
  assert.match(source, /NORMALIZE_CITY_GEOMETRY_DERIVED/);
});

test('schema CI contains a V036-to-current detached geometry upgrade scenario', async () => {
  const source = await fs.readFile(
    path.join(root, 'scripts/verify-geometry-upgrade-ci.js'),
    'utf8',
  );

  assert.match(source, /migration\.version <= 36/);
  assert.match(source, /generate_series\(1, 10\)/);
  assert.match(source, /city_id IS NULL/);
  assert.match(source, /boundary_id IS NULL/);
  assert.match(source, /effective_city_geometries/);
});
