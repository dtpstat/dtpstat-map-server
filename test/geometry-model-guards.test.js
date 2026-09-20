import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');

test('city/boundary normalized identity is a deferred database invariant', async () => {
  const migration = await read('db/migrations/V037__city_boundary_identity_and_pending_guards.sql');
  assert.match(migration, /VALIDATE_CITY_BOUNDARY_IDENTITY/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER CITIES_BOUNDARY_IDENTITY_CHECK/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER CITY_BOUNDARIES_IDENTITY_CHECK/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /GEOMETRY_MODEL_INTEGRITY/);
});

test('all boundary/geometry dictionary writers respect pending conflict sessions', async () => {
  const [admin, update, transfer, lineTypes, editor] = await Promise.all([
    read('src/db/osm-boundary-admin-repository.js'),
    read('src/db/osm-city-update-service.js'),
    read('src/db/city-boundary-transfer-service.js'),
    read('src/db/line-types-repository.js'),
    read('src/db/geometry-editor-repository.js'),
  ]);
  assert.match(admin, /SELECT assert_no_pending_geometry_import\(\)/);
  assert.match(update, /SELECT assert_no_pending_geometry_import\(\)/);
  assert.match(transfer, /SELECT assert_no_pending_geometry_import\(\)/);
  assert.match(lineTypes, /SELECT assert_no_pending_geometry_import\(\)/);
  assert.match(editor, /SELECT assert_no_pending_geometry_import\(\)/);
});
