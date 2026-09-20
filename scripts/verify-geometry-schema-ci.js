import pg from 'pg';

const { Client } = pg;

const client = new Client({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_ROLE,
  password: process.env.DATABASE_ROLE_PASSWORD,
  options: '-c search_path=buslanes,public',
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectCommitFailure(operation, messagePattern) {
  await client.query('BEGIN');
  try {
    await operation();
    let failure = null;
    try {
      await client.query('COMMIT');
    } catch (error) {
      failure = error;
    }
    assert(failure, 'Expected COMMIT to fail, but it succeeded');
    if (messagePattern) {
      assert(
        messagePattern.test(String(failure.message)),
        `Unexpected deferred-constraint error: ${failure.message}`,
      );
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }
}

await client.connect();
try {
  const version = await client.query(
    'SELECT MAX(version)::integer AS version FROM buslanes.schema_versions',
  );
  assert(version.rows[0]?.version === 39, 'Expected schema version 39');

  const postgis = await client.query('SELECT PostGIS_Version() AS version');
  assert(postgis.rows[0]?.version, 'PostGIS is not available');

  const initialIntegrity = await client.query(
    'SELECT * FROM geometry_model_integrity',
  );
  assert(initialIntegrity.rows.length === 0, 'Fresh schema integrity view is not empty');

  // Active OSM boundary may be created before its application city inside the
  // same transaction, but sync must establish a valid link before COMMIT.
  await client.query('BEGIN');
  const boundary = await client.query(`
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
      900000001,
      'Schema City',
      '{"name":"Schema City"}'::jsonb,
      geom,
      ST_Envelope(geom),
      TRUE,
      'Schema City',
      'city',
      ST_Area(geom::geography)
    FROM prepared
    RETURNING id::bigint AS id
  `);
  const boundaryId = Number(boundary.rows[0].id);
  await client.query('SELECT sync_active_boundary_cities()');
  const preCommitState = await client.query(`
    SELECT
      boundary.id::bigint AS boundary_id,
      boundary.city_id::bigint AS boundary_city_id,
      boundary.osm_type,
      boundary.osm_id::text AS osm_id,
      boundary.display_name,
      boundary.display_type,
      COALESCE(
        json_agg(
          json_build_object(
            'id', city.id,
            'slug', city.slug,
            'name', city.name,
            'displayType', city.display_type
          )
        ) FILTER (WHERE city.id IS NOT NULL),
        '[]'::json
      ) AS cities
    FROM city_boundaries AS boundary
    LEFT JOIN cities AS city ON TRUE
    WHERE boundary.id = $1
    GROUP BY boundary.id
  `, [boundaryId]);
  console.log('pre-commit sync state', JSON.stringify(preCommitState.rows[0], null, 2));
  await client.query('COMMIT');

  let ownership = await client.query(`
    SELECT boundary.city_id::bigint AS boundary_city_id,
           city.id::bigint AS city_id,
           city.name
    FROM city_boundaries AS boundary
    JOIN cities AS city ON city.id = boundary.city_id
    WHERE boundary.id = $1
  `, [boundaryId]);
  const firstCityId = Number(ownership.rows[0].city_id);
  assert(firstCityId > 0, 'Active boundary did not obtain CITY_ID');
  assert(ownership.rows[0].name === 'Schema City', 'City identity was not synchronized');

  const lineType = await client.query(
    'SELECT id::bigint AS id FROM line_types ORDER BY id LIMIT 1',
  );
  const lineTypeId = Number(lineType.rows[0]?.id);
  assert(lineTypeId > 0, 'No line type exists after migrations');

  const insertedGeometry = await client.query(`
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
      '{}'::jsonb,
      ST_GeomFromText('LINESTRING(20.001 44.001,20.01 44.01)', 4326),
      'Invariant line',
      '{}'::jsonb,
      ARRAY['schema-ci']::text[],
      TRUE,
      FALSE
    )
    RETURNING id::bigint AS id, length_m, lane_length_m
  `, [firstCityId, boundaryId, lineTypeId]);
  const geometryId = Number(insertedGeometry.rows[0].id);
  const length = Number(insertedGeometry.rows[0].length_m);
  const laneLength = Number(insertedGeometry.rows[0].lane_length_m);
  assert(length > 0, 'Derived LENGTH_M trigger did not run');
  assert(
    Math.abs(laneLength - length * 2) < 0.001,
    'Derived LANE_LENGTH_M does not match lanes',
  );

  // This is the important update path: an administrator changes the active OSM
  // identity. sync() must rebind the boundary and the geometry atomically.
  await client.query('BEGIN');
  await client.query(
    `UPDATE city_boundaries
     SET display_name = 'Schema City Renamed',
         updated_at = NOW()
     WHERE id = $1`,
    [boundaryId],
  );
  await client.query('SELECT sync_active_boundary_cities()');
  await client.query('COMMIT');

  ownership = await client.query(`
    SELECT boundary.city_id::bigint AS boundary_city_id,
           geometry.city_id::bigint AS geometry_city_id,
           city.name
    FROM city_boundaries AS boundary
    JOIN city_geometries AS geometry ON geometry.id = $2
    JOIN cities AS city ON city.id = boundary.city_id
    WHERE boundary.id = $1
  `, [boundaryId, geometryId]);
  assert(
    Number(ownership.rows[0].boundary_city_id) ===
      Number(ownership.rows[0].geometry_city_id),
    'Boundary rename left geometry attached to another city',
  );
  assert(
    ownership.rows[0].name === 'Schema City Renamed',
    'Boundary rename did not synchronize city identity',
  );

  const canonicalCityId = Number(ownership.rows[0].boundary_city_id);
  const otherCity = await client.query(`
    INSERT INTO cities (
      slug, name, full_name, display_type, lane_length_m, attributes
    )
    VALUES (
      'schema-ci-other',
      'Schema Other',
      'Schema Other',
      'city',
      0,
      '{}'::jsonb
    )
    RETURNING id::bigint AS id
  `);
  const otherCityId = Number(otherCity.rows[0].id);

  await client.query(
    'UPDATE city_geometries SET city_id = $2 WHERE id = $1',
    [geometryId, otherCityId],
  );
  const normalizedOwner = await client.query(
    'SELECT city_id::bigint AS city_id FROM city_geometries WHERE id = $1',
    [geometryId],
  );
  assert(
    Number(normalizedOwner.rows[0].city_id) === canonicalCityId,
    'Geometry CITY_ID was not normalized back from BOUNDARY_ID',
  );

  await expectCommitFailure(
    () => client.query(
      "UPDATE cities SET name = 'Broken Identity' WHERE id = $1",
      [canonicalCityId],
    ),
    /different normalized identity/i,
  );

  await expectCommitFailure(
    () => client.query(`
      WITH prepared AS (
        SELECT ST_Multi(
          ST_GeomFromText(
            'POLYGON((21 45,21.01 45,21.01 45.01,21 45.01,21 45))',
            4326
          )
        ) AS geom
      )
      INSERT INTO city_boundaries (
        place_type, admin_level, osm_type, osm_id, osm_name, tags,
        geom, bounds, is_active, display_name, display_type, area_m2
      )
      SELECT
        'city', 8, 'relation', 900000002, 'Orphan Active',
        '{}'::jsonb, geom, ST_Envelope(geom), TRUE,
        'Orphan Active', 'city', ST_Area(geom::geography)
      FROM prepared
    `),
    /has no CITY_ID/i,
  );

  // Deactivation must remove the row only from the effective set, not from
  // durable CITY_GEOMETRIES storage. Reactivation restores it automatically.
  await client.query('BEGIN');
  await client.query(
    'UPDATE city_boundaries SET is_active = FALSE WHERE id = $1',
    [boundaryId],
  );
  await client.query('COMMIT');

  let effective = await client.query(
    'SELECT id FROM effective_city_geometries WHERE id = $1',
    [geometryId],
  );
  assert(effective.rowCount === 0, 'Inactive boundary geometry remained effective');
  const durable = await client.query(
    'SELECT id FROM city_geometries WHERE id = $1',
    [geometryId],
  );
  assert(durable.rowCount === 1, 'Boundary deactivation deleted durable geometry');

  await client.query('BEGIN');
  await client.query(
    'UPDATE city_boundaries SET is_active = TRUE WHERE id = $1',
    [boundaryId],
  );
  await client.query('SELECT sync_active_boundary_cities()');
  await client.query('COMMIT');

  effective = await client.query(
    'SELECT id FROM effective_city_geometries WHERE id = $1',
    [geometryId],
  );
  assert(effective.rowCount === 1, 'Reactivated boundary geometry did not become effective');

  const pending = await client.query(`
    INSERT INTO geometry_import_sessions (kind, status, metadata)
    VALUES ('kml', 'pending', '{}'::jsonb)
    RETURNING id
  `);
  let pendingFailure = null;
  try {
    await client.query('SELECT assert_no_pending_geometry_import()');
  } catch (error) {
    pendingFailure = error;
  }
  assert(pendingFailure?.code === '55000', 'Pending-import guard did not reject mutation');
  await client.query(
    'DELETE FROM geometry_import_sessions WHERE id = $1',
    [pending.rows[0].id],
  );

  const finalIntegrity = await client.query(
    'SELECT * FROM geometry_model_integrity',
  );
  assert(
    finalIntegrity.rows.length === 0,
    'Geometry integrity view contains issues: ' + JSON.stringify(finalIntegrity.rows),
  );

  console.log(JSON.stringify({
    schemaVersion: version.rows[0].version,
    postgis: postgis.rows[0].version,
    boundaryId,
    geometryId,
    canonicalCityId,
    integrityIssues: finalIntegrity.rows.length,
  }, null, 2));
} finally {
  await client.end();
}
