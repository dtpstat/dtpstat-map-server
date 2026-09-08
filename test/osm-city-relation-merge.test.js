import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function migration() {
  return fs.readFile(
    path.join(root, 'db/migrations/V023__merge_osm_relation_city_parts.sql'),
    'utf8',
  );
}

test('OSM relation fragments are grouped by logical full name and place type', async () => {
  const sql = await migration();

  assert.match(
    sql,
    /COALESCE\([\s\S]*TAGS\s*->>\s*'addr:district'[\s\S]*TAGS\s*->>\s*'name:ru'[\s\S]*OSM_NAME/i,
  );
  assert.match(sql, /WHERE\s+OSM_TYPE\s*=\s*'relation'/i);
  assert.match(sql, /GROUP BY\s+PLACE_TYPE,\s*FULL_NAME/i);
  assert.match(sql, /HAVING\s+COUNT\(\*\)\s*>\s*1/i);
  assert.match(sql, /ST_UNARYUNION\(ST_COLLECT\(GEOM\)\)/i);
  assert.match(sql, /BOUNDS\s*=\s*ST_ENVELOPE\(GROUP_ROW\.MERGED_GEOM\)/i);
});

test('OSM normalization runs after each boundary snapshot insert', async () => {
  const sql = await migration();

  assert.match(
    sql,
    /CREATE TRIGGER CITY_BOUNDARIES_NORMALIZE_RELATIONS[\s\S]*AFTER INSERT[\s\S]*FOR EACH STATEMENT/i,
  );
  assert.match(
    sql,
    /SELECT BUSLANES\.NORMALIZE_CITY_BOUNDARY_RELATIONS\(\)/i,
  );
});

test('linked city keeps short NAME while OSM logical name becomes FULL_NAME', async () => {
  const sql = await migration();

  assert.match(
    sql,
    /UPDATE BUSLANES\.CITIES[\s\S]*SET FULL_NAME = NEW\.FULL_NAME/i,
  );
  assert.doesNotMatch(
    sql,
    /SET\s+NAME\s*=\s*NEW\.FULL_NAME/i,
  );
});
