import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = (name) => fs.readFile(path.join(root, 'db/migrations', name), 'utf8');

test('database migrations retain critical relational and spatial access paths', async () => {
  const [v001, v002, v004, v005, v007, v009, v013, v014, v015] = await Promise.all([
    migration('V001__base_schema.sql'),
    migration('V002__population_statistics.sql'),
    migration('V004__osm_city_boundaries.sql'),
    migration('V005__place_boundaries_and_polygon_matching.sql'),
    migration('V007__admin_task_successes.sql'),
    migration('V009__project_settings.sql'),
    migration('V013__numeric_line_type_codes_and_titles.sql'),
    migration('V014__configurable_city_reports.sql'),
    migration('V015__index_audit.sql'),
  ]);

  // Cities and one-to-one dimension tables are covered by PK/UNIQUE indexes.
  assert.match(v001, /SOURCE_INDEX\s+INTEGER UNIQUE/i);
  assert.match(v001, /SLUG\s+TEXT\s+NOT NULL UNIQUE/i);
  assert.match(v001, /NAME\s+TEXT\s+NOT NULL UNIQUE/i);
  assert.match(v002, /CITY_ID\s+BIGINT\s+PRIMARY KEY/i);
  assert.match(v007, /TASK_TYPE\s+TEXT PRIMARY KEY/i);
  assert.match(v009, /ID\s+SMALLINT\s+PRIMARY KEY/i);
  assert.match(v014, /CITY_ID\s+BIGINT PRIMARY KEY/i);
  assert.match(v014, /CITY_REPORT_VALUES_RANK_IDX/i);

  // Spatial selectors must keep GiST indexes for line and boundary intersection.
  assert.match(v001, /CITY_GEOMETRIES_GEOM_GIST_IDX[\s\S]*USING GIST \(GEOM\)/i);
  assert.match(v004, /CITY_BOUNDARIES_GEOM_GIST_IDX[\s\S]*USING GIST \(GEOM\)/i);
  assert.match(v004, /CITY_BOUNDARIES_BOUNDS_GIST_IDX[\s\S]*USING GIST \(BOUNDS\)/i);

  // Boundary/import identity and reverse FK lookups have B-tree access paths.
  assert.match(v004, /UNIQUE \(OSM_TYPE, OSM_ID\)/i);
  assert.match(v005, /CITY_BOUNDARIES_CITY_ID_UNIQUE_IDX/i);
  assert.match(v005, /CITY_GEOMETRIES_BOUNDARY_ID_IDX/i);
  assert.match(v013, /LINE_TYPES_NAME_CI_UIDX[\s\S]*LOWER\(BTRIM\(NAME\)\)/i);

  // V015 replaces the redundant city-only geometry index with a composite
  // whose left prefix still serves CITY_ID-only requests.
  assert.match(v015, /CITY_GEOMETRIES_CITY_LINE_TYPE_IDX[\s\S]*\(CITY_ID, LINE_TYPE_ID\)/i);
  assert.match(v015, /DROP INDEX IF EXISTS BUSLANES\.CITY_GEOMETRIES_CITY_ID_IDX/i);
});
