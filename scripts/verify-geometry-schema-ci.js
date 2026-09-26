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
const expectedVersion =
  migrations.at(-1)
    ?.version;

assert.ok(
  expectedVersion > 0,
  'Expected at least one migration',
);

const client =
  createDatabaseClient();

async function expectDeferredFailure(
  operation,
  messagePattern,
) {
  await client.query(
    'BEGIN',
  );

  try {
    await operation();

    let failure = null;
    try {
      await client.query(
        'SET CONSTRAINTS ALL IMMEDIATE',
      );
    } catch (error) {
      failure = error;
    }

    assert.ok(
      failure,
      'Expected deferred constraint failure',
    );

    if (messagePattern) {
      assert.match(
        String(
          failure.message,
        ),
        messagePattern,
      );
    }
  } finally {
    await client
      .query(
        'ROLLBACK',
      )
      .catch(
        () => {},
      );
  }
}

async function relationExists(
  name,
) {
  const result =
    await client.query(
      'SELECT to_regclass($1) AS relation',
      [
        `${schema}.${name}`,
      ],
    );

  return Boolean(
    result.rows[0]
      ?.relation,
  );
}

await client.connect();

try {
  const version =
    await client.query(
      `
        SELECT
          COUNT(*)::integer AS count,
          MAX(version)::integer AS version
        FROM ${schema}.schema_versions
      `,
    );

  assert.equal(
    version.rows[0]
      ?.count,
    migrations.length,
    'Migration history is incomplete',
  );
  assert.equal(
    version.rows[0]
      ?.version,
    expectedVersion,
    'Database is not at the current migration version',
  );

  const postgis =
    await client.query(
      'SELECT PostGIS_Version() AS version',
    );

  assert.equal(
    typeof postgis.rows[0]
      ?.version,
    'string',
  );
  assert.ok(
    postgis.rows[0]
      .version.length >
      0,
  );

  for (
    const relation of [
      'geometry_import_sessions',
      'geometry_import_stage',
      'geometry_import_conflicts',
      'geometry_model_integrity',
      'effective_city_geometries',
    ]
  ) {
    assert.equal(
      await relationExists(
        relation,
      ),
      true,
      `Missing geometry relation ${relation}`,
    );
  }

  const permission =
    await client.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = 'admin_users'
            AND column_name = 'can_edit_geometries'
        ) AS exists
      `,
      [schema],
    );

  assert.equal(
    permission.rows[0]
      ?.exists,
    true,
    'Geometry editor permission column is missing',
  );

  const triggerState =
    await client.query(
      `
        SELECT COUNT(*)::integer AS count
        FROM pg_trigger AS trigger
        JOIN pg_class AS relation
          ON relation.oid = trigger.tgrelid
        JOIN pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = $1
          AND trigger.tgname IN (
            'city_boundaries_final_state_check',
            'city_geometries_final_state_check'
          )
          AND NOT trigger.tgisinternal
      `,
      [schema],
    );

  assert.equal(
    triggerState.rows[0]
      ?.count,
    2,
    'Final-state geometry constraint triggers are missing',
  );

  const initialIntegrity =
    await client.query(
      'SELECT * FROM geometry_model_integrity',
    );

  assert.equal(
    initialIntegrity.rowCount,
    0,
    'Fresh geometry integrity view is not empty',
  );

  await client.query(
    'BEGIN',
  );

  const boundary =
    await client.query(
      `
        WITH prepared AS (
          SELECT ST_Multi(
            ST_GeomFromText(
              'POLYGON((20 44,20.02 44,20.02 44.02,20 44.02,20 44))',
              4326
            )
          ) AS geom
        )
        INSERT INTO city_boundaries (
          place_type,
          admin_level,
          osm_type,
          osm_id,
          osm_name,
          tags,
          geom,
          bounds,
          is_active,
          display_name,
          display_type,
          area_m2
        )
        SELECT
          'city',
          8,
          'relation',
          990000001,
          'Geometry Schema CI',
          '{"name":"Geometry Schema CI"}'::jsonb,
          geom,
          ST_Envelope(geom),
          TRUE,
          'Geometry Schema CI',
          'city',
          ST_Area(geom::geography)
        FROM prepared
        RETURNING id::bigint AS id
      `,
    );

  const boundaryId =
    Number(
      boundary.rows[0]
        .id,
    );

  await client.query(
    'SELECT sync_active_boundary_cities()',
  );
  await client.query(
    'COMMIT',
  );

  const ownership =
    await client.query(
      `
        SELECT
          boundary.city_id::bigint AS boundary_city_id,
          city.id::bigint AS city_id,
          city.name
        FROM city_boundaries AS boundary
        JOIN cities AS city
          ON city.id = boundary.city_id
        WHERE boundary.id = $1
      `,
      [boundaryId],
    );

  const firstCityId =
    Number(
      ownership.rows[0]
        ?.city_id,
    );

  assert.ok(
    firstCityId > 0,
    'Active boundary did not obtain a city link',
  );
  assert.equal(
    ownership.rows[0]
      ?.name,
    'Geometry Schema CI',
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
    'No line type exists after migrations',
  );

  const inserted =
    await client.query(
      `
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
        VALUES (
          $1,
          $2,
          $3,
          2,
          0,
          0,
          '{"source":"geometry-schema-ci"}'::jsonb,
          ST_GeomFromText(
            'LINESTRING(20.001 44.001,20.01 44.01)',
            4326
          ),
          'Geometry schema invariant line',
          '{}'::jsonb,
          ARRAY['schema-ci']::text[],
          TRUE,
          FALSE
        )
        RETURNING
          id::bigint AS id,
          length_m,
          lane_length_m
      `,
      [
        firstCityId,
        boundaryId,
        lineTypeId,
      ],
    );

  const geometryId =
    Number(
      inserted.rows[0]
        .id,
    );
  const length =
    Number(
      inserted.rows[0]
        .length_m,
    );
  const laneLength =
    Number(
      inserted.rows[0]
        .lane_length_m,
    );

  assert.ok(
    length > 0,
    'Derived line length trigger did not run',
  );
  assert.ok(
    Math.abs(
      laneLength -
      length * 2,
    ) <
      0.001,
    'Derived lane length does not match lanes',
  );

  await client.query(
    'BEGIN',
  );
  await client.query(
    `
      UPDATE city_boundaries
      SET
        display_name = 'Geometry Schema CI Renamed',
        updated_at = NOW()
      WHERE id = $1
    `,
    [boundaryId],
  );
  await client.query(
    'SELECT sync_active_boundary_cities()',
  );
  await client.query(
    'COMMIT',
  );

  const rebound =
    await client.query(
      `
        SELECT
          boundary.city_id::bigint AS boundary_city_id,
          geometry.city_id::bigint AS geometry_city_id,
          city.name
        FROM city_boundaries AS boundary
        JOIN city_geometries AS geometry
          ON geometry.id = $2
        JOIN cities AS city
          ON city.id = boundary.city_id
        WHERE boundary.id = $1
      `,
      [
        boundaryId,
        geometryId,
      ],
    );

  const canonicalCityId =
    Number(
      rebound.rows[0]
        ?.boundary_city_id,
    );

  assert.equal(
    Number(
      rebound.rows[0]
        ?.geometry_city_id,
    ),
    canonicalCityId,
    'Boundary rename left geometry attached to another city',
  );
  assert.equal(
    rebound.rows[0]
      ?.name,
    'Geometry Schema CI Renamed',
  );

  const otherCity =
    await client.query(
      `
        INSERT INTO cities (
          slug,
          name,
          full_name,
          display_type,
          lane_length_m,
          attributes
        )
        VALUES (
          'geometry-schema-ci-other',
          'Geometry Schema Other',
          'Geometry Schema Other',
          'city',
          0,
          '{}'::jsonb
        )
        RETURNING id::bigint AS id
      `,
    );
  const otherCityId =
    Number(
      otherCity.rows[0]
        .id,
    );

  await client.query(
    `
      UPDATE city_geometries
      SET city_id = $2
      WHERE id = $1
    `,
    [
      geometryId,
      otherCityId,
    ],
  );

  const normalizedOwner =
    await client.query(
      `
        SELECT city_id::bigint AS city_id
        FROM city_geometries
        WHERE id = $1
      `,
      [geometryId],
    );

  assert.equal(
    Number(
      normalizedOwner.rows[0]
        ?.city_id,
    ),
    canonicalCityId,
    'Boundary-owned geometry did not normalize its city link',
  );

  await expectDeferredFailure(
    () =>
      client.query(
        `
          UPDATE cities
          SET name = 'Broken Geometry Identity'
          WHERE id = $1
        `,
        [canonicalCityId],
      ),
    /different normalized identity|final-state violation/iu,
  );

  await expectDeferredFailure(
    () =>
      client.query(
        `
          WITH prepared AS (
            SELECT ST_Multi(
              ST_GeomFromText(
                'POLYGON((21 45,21.01 45,21.01 45.01,21 45.01,21 45))',
                4326
              )
            ) AS geom
          )
          INSERT INTO city_boundaries (
            place_type,
            admin_level,
            osm_type,
            osm_id,
            osm_name,
            tags,
            geom,
            bounds,
            is_active,
            display_name,
            display_type,
            area_m2
          )
          SELECT
            'city',
            8,
            'relation',
            990000002,
            'Geometry Orphan CI',
            '{}'::jsonb,
            geom,
            ST_Envelope(geom),
            TRUE,
            'Geometry Orphan CI',
            'city',
            ST_Area(geom::geography)
          FROM prepared
        `,
      ),
    /active-boundary-without-city|final-state violation/iu,
  );

  await client.query(
    'BEGIN',
  );
  await client.query(
    `
      UPDATE city_boundaries
      SET is_active = FALSE
      WHERE id = $1
    `,
    [boundaryId],
  );
  await client.query(
    'COMMIT',
  );

  const inactiveEffective =
    await client.query(
      `
        SELECT id
        FROM effective_city_geometries
        WHERE id = $1
      `,
      [geometryId],
    );

  assert.equal(
    inactiveEffective.rowCount,
    0,
    'Inactive boundary geometry remained effective',
  );

  const durable =
    await client.query(
      `
        SELECT id
        FROM city_geometries
        WHERE id = $1
      `,
      [geometryId],
    );

  assert.equal(
    durable.rowCount,
    1,
    'Boundary deactivation deleted durable geometry',
  );

  await client.query(
    'BEGIN',
  );
  await client.query(
    `
      UPDATE city_boundaries
      SET is_active = TRUE
      WHERE id = $1
    `,
    [boundaryId],
  );
  await client.query(
    'SELECT sync_active_boundary_cities()',
  );
  await client.query(
    'COMMIT',
  );

  const activeEffective =
    await client.query(
      `
        SELECT id
        FROM effective_city_geometries
        WHERE id = $1
      `,
      [geometryId],
    );

  assert.equal(
    activeEffective.rowCount,
    1,
    'Reactivated boundary geometry did not become effective',
  );

  await client.query(
    'BEGIN',
  );

  const pending =
    await client.query(
      `
        INSERT INTO geometry_import_sessions (
          kind,
          status,
          metadata
        )
        VALUES (
          'kml',
          'pending',
          '{}'::jsonb
        )
        RETURNING id
      `,
    );

  let pendingFailure = null;
  try {
    await client.query(
      'SELECT assert_no_pending_geometry_import()',
    );
  } catch (error) {
    pendingFailure = error;
  }

  assert.equal(
    pendingFailure?.code,
    '55000',
    'Pending geometry import guard did not reject mutation',
  );

  assert.ok(
    pending.rows[0]
      ?.id,
  );

  await client.query(
    'ROLLBACK',
  );

  const finalIntegrity =
    await client.query(
      'SELECT * FROM geometry_model_integrity',
    );

  assert.equal(
    finalIntegrity.rowCount,
    0,
    'Geometry integrity view contains issues',
  );

  console.log(
    JSON.stringify(
      {
        schema,
        schemaVersion:
          expectedVersion,
        postgis:
          postgis.rows[0]
            .version,
        boundaryId,
        geometryId,
        canonicalCityId,
        integrityIssues:
          finalIntegrity.rowCount,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
