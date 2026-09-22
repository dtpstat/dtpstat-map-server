import 'dotenv/config';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from './database.js';
import { loadDatabaseSchema } from '../src/db/database-environment.js';
import { applyMigrations, loadMigrations } from './migrate.js';

const schema = loadDatabaseSchema();
const client = createDatabaseClient();

await client.connect();
try {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const migrations = await loadMigrations(path.join(root, 'db', 'migrations'));
  const throughV036 = migrations.filter((migration) => migration.version <= 38);

  const version36Result = await applyMigrations(client, throughV036, { schema });
  const version36 = version36Result.version;
  assert.equal(version36, 36, 'Expected pre-upgrade schema version 36');

  const lineType = await client.query(
    'SELECT id::bigint AS id FROM line_types ORDER BY id LIMIT 1',
  );
  const lineTypeId = Number(lineType.rows[0]?.id);
  assert(lineTypeId > 0, 'V036 schema has no line type for legacy geometry seed');

  const inserted = await client.query(`
    WITH legacy AS (
      SELECT
        seq,
        ST_SetSRID(
          ST_MakeLine(
            ST_MakePoint(20.0 + seq * 0.001, 44.0),
            ST_MakePoint(20.0005 + seq * 0.001, 44.0005)
          ),
          4326
        ) AS geom
      FROM generate_series(1, 10) AS seq
    )
    INSERT INTO city_geometries (
      city_id,
      boundary_id,
      line_type_id,
      lanes,
      length_m,
      lane_length_m,
      properties,
      geom,
      display_name,
      source_tags,
      tags,
      is_visible,
      was_edited
    )
    SELECT
      NULL,
      NULL,
      $1,
      1,
      ST_Length(legacy.geom::geography),
      ST_Length(legacy.geom::geography),
      jsonb_build_object('source', 'legacy-upgrade-ci', 'seq', legacy.seq),
      legacy.geom,
      'Legacy detached #' || legacy.seq,
      '{}'::jsonb,
      '{}'::text[],
      TRUE,
      FALSE
    FROM legacy
    RETURNING id
  `, [lineTypeId]);
  assert.equal(inserted.rowCount, 10, 'Expected ten detached legacy geometries');

  const before = await client.query(`
    SELECT COUNT(*)::integer AS count
    FROM city_geometries
    WHERE properties ->> 'source' = 'legacy-upgrade-ci'
      AND city_id IS NULL
      AND boundary_id IS NULL
  `);
  assert.equal(before.rows[0]?.count, 10, 'Legacy detached seed is invalid');

  const finalResult = await applyMigrations(client, migrations, { schema });
  const finalVersion = finalResult.version;
  assert.equal(finalVersion, 40, 'Expected final schema version 40');

  const after = await client.query(`
    SELECT COUNT(*)::integer AS count
    FROM city_geometries
    WHERE properties ->> 'source' = 'legacy-upgrade-ci'
      AND city_id IS NULL
      AND boundary_id IS NULL
  `);
  assert.equal(
    after.rows[0]?.count,
    10,
    'Upgrade must preserve detached geometries with NULL CITY_ID',
  );

  const effective = await client.query(`
    SELECT COUNT(*)::integer AS count
    FROM effective_city_geometries
    WHERE properties ->> 'source' = 'legacy-upgrade-ci'
  `);
  assert.equal(
    effective.rows[0]?.count,
    0,
    'Detached legacy geometries must not participate in effective/public metrics',
  );

  const integrity = await client.query('SELECT * FROM geometry_model_integrity');
  assert.equal(
    integrity.rowCount,
    0,
    'Detached geometries must not be reported as model-integrity violations',
  );

  console.log(JSON.stringify({
    fromVersion: 36,
    toVersion: finalVersion,
    preservedDetachedGeometries: after.rows[0].count,
    effectiveDetachedGeometries: effective.rows[0].count,
  }, null, 2));
} finally {
  await client.end();
}
