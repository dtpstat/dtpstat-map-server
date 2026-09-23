import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function migration(name) {
  return fs.readFile(path.join(root, 'db/migrations', name), 'utf8');
}

test('V027 explicitly retires the historical cross-object relation merge', async () => {
  const [historical, current] = await Promise.all([
    migration('V023__merge_osm_relation_city_parts.sql'),
    migration('V027__osm_boundary_management.sql'),
  ]);

  // V023 is immutable migration history and therefore still documents the old
  // name-based grouping that produced unrelated multipart polygons.
  assert.match(historical, /GROUP BY\s+PLACE_TYPE,\s*FULL_NAME/i);
  assert.match(historical, /ST_UNARYUNION\(ST_COLLECT\(GEOM\)\)/i);

  // V027 must neutralize that model without rewriting migration history.
  assert.match(
    current,
    /DROP TRIGGER IF EXISTS CITY_BOUNDARIES_NORMALIZE_RELATIONS/i,
  );
  assert.match(
    current,
    /DROP FUNCTION IF EXISTS BUSLANES\.NORMALIZE_CITY_BOUNDARY_RELATIONS\(\)/i,
  );
  assert.match(current, /DROP INDEX IF EXISTS BUSLANES\.CITY_BOUNDARIES_LOGICAL_NAME_IDX/i);
  assert.match(current, /DROP COLUMN IF EXISTS FULL_NAME/i);
  assert.doesNotMatch(current, /ST_UNARYUNION\(ST_COLLECT\(GEOM\)\)/i);
});

test('V027 keeps active identity separate from immutable OSM object identity', async () => {
  const sql = await migration('V027__osm_boundary_management.sql');

  assert.match(sql, /ADD COLUMN IF NOT EXISTS IS_ACTIVE BOOLEAN/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS DISPLAY_NAME TEXT/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS DISPLAY_TYPE TEXT/i);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS CITY_BOUNDARIES_ACTIVE_DISPLAY_UNIQUE_IDX[\s\S]*WHERE IS_ACTIVE/i,
  );
  assert.match(
    sql,
    /LOWER\(REGEXP_REPLACE\(DISPLAY_NAME, '\[\[:space:\]\]\+', '', 'g'\)\)/i,
  );
});

test('V027 hierarchy uses full containment and never mere intersection', async () => {
  const sql = await migration('V027__osm_boundary_management.sql');

  assert.match(sql, /CREATE OR REPLACE FUNCTION BUSLANES\.REBUILD_CITY_BOUNDARY_HIERARCHY/i);
  assert.match(sql, /ST_COVERS\(PARENT\.GEOM, CHILD\.GEOM\)/i);
  assert.match(sql, /NOT ST_EQUALS\(PARENT\.GEOM, CHILD\.GEOM\)/i);
  assert.match(sql, /ORDER BY PARENT\.AREA_M2, PARENT\.ID/i);
});
