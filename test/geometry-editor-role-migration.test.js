import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('V036 adds the independent geometry editor role after inherited OSM permission', async () => {
  const [osmRole, geometryRole] = await Promise.all([
    readFile(path.resolve('db/migrations/V035__osm_editor_role.sql'), 'utf8'),
    readFile(path.resolve('db/migrations/V036__geometry_editor_role.sql'), 'utf8'),
  ]);
  assert.match(osmRole, /ADD COLUMN IF NOT EXISTS CAN_EDIT_OSM BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.doesNotMatch(osmRole, /CAN_EDIT_GEOMETRIES/i);
  assert.match(geometryRole, /ADD COLUMN IF NOT EXISTS CAN_EDIT_GEOMETRIES BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.match(geometryRole, /SET CAN_EDIT_GEOMETRIES = TRUE/i);
  assert.match(geometryRole, /WHERE CAN_MANAGE_DATA/i);
  assert.match(geometryRole, /OR IS_SUPERUSER/i);
  assert.match(geometryRole, /OR IS_BOOTSTRAP/i);
  assert.doesNotMatch(geometryRole, /ADD COLUMN IF NOT EXISTS CAN_EDIT_OSM/i);
});
