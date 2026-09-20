import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('final V038 geometry model supports durable detached rows and exact effective ownership', async () => {
  const source = await fs.readFile(
    path.join(root, 'db/migrations/V038__effective_geometry_ownership.sql'),
    'utf8',
  );
  assert.match(source, /ALTER COLUMN CITY_ID DROP NOT NULL/);
  assert.match(source, /ON DELETE SET NULL/);
  assert.match(source, /EFFECTIVE_CITY_GEOMETRIES/);
  assert.match(source, /BOUNDARY\.ID = GEOMETRY\.BOUNDARY_ID/);
  assert.match(source, /BOUNDARY\.IS_ACTIVE/);
  assert.match(source, /BOUNDARY\.CITY_ID = GEOMETRY\.CITY_ID/);
  assert.match(source, /ASSERT_CITY_GEOMETRY_INVARIANTS/);
});
