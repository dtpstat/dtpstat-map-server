import 'dotenv/config';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  fileURLToPath,
} from 'node:url';
import {
  loadDatabaseSchema,
} from '../src/db/database-environment.js';
import {
  applyMigrations,
  loadMigrations,
} from '../src/db/migration-runner.js';
import {
  createDatabaseClient,
} from './database.js';

const projectRoot =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );
const schema =
  loadDatabaseSchema();
const migrations =
  await loadMigrations(
    path.join(
      projectRoot,
      'db',
      'migrations',
    ),
  );
const geometryRoleMigration =
  migrations.find(
    (migration) =>
      migration.name ===
      'geometry_editor_role',
  );

assert.ok(
  geometryRoleMigration,
  'Geometry editor role migration is missing',
);

const preGeometryVersion =
  geometryRoleMigration.version -
  1;
const preGeometryMigrations =
  migrations.filter(
    (migration) =>
      migration.version <=
      preGeometryVersion,
  );
const expectedVersion =
  migrations.at(-1)
    ?.version;

assert.ok(
  preGeometryMigrations.length >
    0,
);
assert.ok(
  expectedVersion >
    preGeometryVersion,
);

const client =
  createDatabaseClient();

await client.connect();

try {
  const before =
    await applyMigrations(
      client,
      preGeometryMigrations,
      {
        schema,
      },
    );

  assert.equal(
    before.version,
    preGeometryVersion,
    'Unexpected pre-geometry schema version',
  );

  const lineType =
    await client.query(
      `
        SELECT id::bigint AS id
        FROM line_types
        ORDER BY id
        LIMIT 1
      `,
    );
  const lineTypeId =
    Number(
      lineType.rows[0]
        ?.id,
    );

  assert.ok(
    lineTypeId > 0,
    'Pre-geometry schema has no line type',
  );

  const inserted =
    await client.query(
      `
        WITH legacy AS (
          SELECT
            seq,
            ST_SetSRID(
              ST_MakeLine(
                ST_MakePoint(
                  20.0 +
                  seq * 0.001,
                  44.0
                ),
                ST_MakePoint(
                  20.0005 +
                  seq * 0.001,
                  44.0005
                )
              ),
              4326
            ) AS geom
          FROM generate_series(
            1,
            10
          ) AS seq
        )
        INSERT INTO city_geometries (
          city_id,
          boundary_id,
          line_type_id,
          lanes,
          length_m,
          lane_length_m,
          properties,
          geom
        )
        SELECT
          NULL,
          NULL,
          $1,
          1,
          ST_Length(
            legacy.geom::geography
          ),
          ST_Length(
            legacy.geom::geography
          ),
          jsonb_build_object(
            'source',
            'geometry-upgrade-ci',
            'seq',
            legacy.seq
          ),
          legacy.geom
        FROM legacy
        RETURNING id
      `,
      [lineTypeId],
    );

  assert.equal(
    inserted.rowCount,
    10,
    'Expected ten detached legacy geometries',
  );

  const administrator =
    await client.query(
      `
        INSERT INTO admin_users (
          username,
          password_hash,
          can_manage_data
        )
        VALUES (
          'geometry-upgrade-ci',
          'geometry-upgrade-ci-hash',
          TRUE
        )
        RETURNING id::bigint AS id
      `,
    );
  const administratorId =
    Number(
      administrator.rows[0]
        ?.id,
    );

  assert.ok(
    administratorId > 0,
  );

  const final =
    await applyMigrations(
      client,
      migrations,
      {
        schema,
      },
    );

  assert.equal(
    final.version,
    expectedVersion,
    'Upgrade did not reach the current migration version',
  );

  const detached =
    await client.query(
      `
        SELECT
          COUNT(*)::integer AS count,
          COUNT(*) FILTER (
            WHERE city_id IS NULL
              AND boundary_id IS NULL
          )::integer AS detached,
          COUNT(*) FILTER (
            WHERE was_edited
          )::integer AS edited,
          COUNT(*) FILTER (
            WHERE source_tags <> '{}'::jsonb
          )::integer AS source_tagged
        FROM city_geometries
        WHERE properties ->> 'source' =
          'geometry-upgrade-ci'
      `,
    );

  assert.equal(
    detached.rows[0]
      ?.count,
    10,
  );
  assert.equal(
    detached.rows[0]
      ?.detached,
    10,
    'Upgrade must preserve detached geometry ownership',
  );
  assert.equal(
    detached.rows[0]
      ?.edited,
    0,
    'Legacy rows must not become manually edited',
  );
  assert.equal(
    detached.rows[0]
      ?.source_tagged,
    0,
    'Non-KML legacy rows must not gain source tags',
  );

  const effective =
    await client.query(
      `
        SELECT COUNT(*)::integer AS count
        FROM effective_city_geometries
        WHERE properties ->> 'source' =
          'geometry-upgrade-ci'
      `,
    );

  assert.equal(
    effective.rows[0]
      ?.count,
    0,
    'Detached legacy geometries must not become effective',
  );

  const permission =
    await client.query(
      `
        SELECT
          can_manage_data AS "canManageData",
          can_edit_geometries AS "canEditGeometries"
        FROM admin_users
        WHERE id = $1
      `,
      [administratorId],
    );

  assert.equal(
    permission.rows[0]
      ?.canManageData,
    true,
  );
  assert.equal(
    permission.rows[0]
      ?.canEditGeometries,
    true,
    'Existing data managers must receive geometry editor access',
  );

  const integrity =
    await client.query(
      'SELECT * FROM geometry_model_integrity',
    );

  assert.equal(
    integrity.rowCount,
    0,
    'Detached legacy geometries must not violate the final model',
  );

  for (
    const relation of [
      'geometry_import_sessions',
      'geometry_import_stage',
      'geometry_import_conflicts',
      'effective_city_geometries',
    ]
  ) {
    const exists =
      await client.query(
        'SELECT to_regclass($1) AS relation',
        [
          `${schema}.${relation}`,
        ],
      );

    assert.ok(
      exists.rows[0]
        ?.relation,
      `Missing relation after upgrade: ${relation}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        schema,
        fromVersion:
          preGeometryVersion,
        toVersion:
          expectedVersion,
        preservedDetachedGeometries:
          detached.rows[0]
            .detached,
        effectiveDetachedGeometries:
          effective.rows[0]
            .count,
        migratedGeometryPermission:
          permission.rows[0]
            .canEditGeometries,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
