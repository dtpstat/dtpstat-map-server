import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const migrationPath = path.resolve(
  'db/migrations/V035__osm_editor_role.sql',
);

test('V035 adds an independent OSM editor permission and preserves prior data-admin access', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(
    sql,
    /ADD COLUMN IF NOT EXISTS CAN_EDIT_OSM BOOLEAN NOT NULL DEFAULT FALSE/i,
  );
  assert.match(sql, /SET CAN_EDIT_OSM = TRUE/i);
  assert.match(sql, /WHERE CAN_MANAGE_DATA/i);
  assert.match(sql, /OR IS_SUPERUSER/i);
  assert.match(sql, /OR IS_BOOTSTRAP/i);
  assert.match(sql, /COMMENT ON COLUMN BUSLANES\.ADMIN_USERS\.CAN_EDIT_OSM/i);
});
