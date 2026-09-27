import { OsmCityGeometryError } from './update-errors.js';

const DROP_STAGE_SQL = 'DROP TABLE IF EXISTS osm_city_boundary_stage';

const MATERIALIZE_CHECKPOINT_STAGE_SQL = `
  CREATE TEMP TABLE osm_city_boundary_stage
  ON COMMIT PRESERVE ROWS
  AS
  SELECT
    name,
    place_type,
    admin_level,
    osm_type,
    osm_id,
    tags,
    geom,
    bounds
  FROM osm_city_update_checkpoint_stage
  WHERE checkpoint_id = $1
    AND geometry_status = 'ready'
`;

const CREATE_STAGE_SQL = `
  CREATE TEMP TABLE osm_city_boundary_stage (
    name text NOT NULL,
    place_type text,
    admin_level smallint,
    osm_type text NOT NULL,
    osm_id bigint NOT NULL,
    tags jsonb NOT NULL,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    bounds geometry(Polygon, 4326) NOT NULL,
    PRIMARY KEY (osm_type, osm_id)
  ) ON COMMIT PRESERVE ROWS
`;

const PRESERVE_LINKS_SQL = `
  CREATE TEMP TABLE old_city_boundary_links ON COMMIT DROP AS
  SELECT
    osm_type,
    osm_id,
    city_id,
    is_active,
    display_name,
    display_type,
    population,
    population_as_of,
    population_source,
    attributes
  FROM city_boundaries;

  CREATE TEMP TABLE old_geometry_boundary_links ON COMMIT DROP AS
  SELECT geometry.id AS geometry_id, boundary.osm_type, boundary.osm_id
  FROM city_geometries AS geometry
  JOIN city_boundaries AS boundary ON boundary.id = geometry.boundary_id
`;

const INSERT_STAGE_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      name text,
      "placeType" text,
      "adminLevel" smallint,
      "osmType" text,
      "osmId" bigint,
      tags jsonb,
      linework jsonb
    )
  ),
  polygons AS (
    SELECT
      payload_rows.*,
      ST_Multi(
        ST_CollectionExtract(
          ST_MakeValid(
            ST_BuildArea(
              ST_Node(
                ST_SetSRID(
                  ST_GeomFromGeoJSON(payload_rows.linework::text),
                  4326
                )
              )
            )
          ),
          3
        )
      ) AS geom
    FROM payload_rows
  )
  INSERT INTO osm_city_boundary_stage (
    name,
    place_type,
    admin_level,
    osm_type,
    osm_id,
    tags,
    geom,
    bounds
  )
  SELECT
    name,
    "placeType",
    "adminLevel",
    "osmType",
    "osmId",
    tags,
    geom,
    ST_Envelope(geom)
  FROM polygons
`;

const INVALID_STAGE_SQL = `
  SELECT name
  FROM osm_city_boundary_stage
  WHERE ST_IsEmpty(geom)
     OR NOT ST_IsValid(geom)
     OR ST_Area(geom::geography) <= 0
  ORDER BY name
`;

const COUNT_STAGE_SQL = `
  SELECT count(*)::integer AS count
  FROM osm_city_boundary_stage
`;

const INSERT_BOUNDARIES_SQL = `
  INSERT INTO city_boundaries (
    city_id,
    place_type,
    admin_level,
    osm_type,
    osm_id,
    osm_name,
    tags,
    geom,
    bounds,
    osm_timestamp,
    is_active,
    display_name,
    display_type,
    population,
    population_as_of,
    population_source,
    attributes,
    area_m2
  )
  SELECT
    old_link.city_id,
    stage.place_type,
    stage.admin_level,
    stage.osm_type,
    stage.osm_id,
    stage.name,
    stage.tags,
    stage.geom,
    stage.bounds,
    $1::timestamptz,
    COALESCE(old_link.is_active, FALSE),
    COALESCE(
      old_link.display_name,
      NULLIF(BTRIM(stage.tags ->> 'name:ru'), ''),
      stage.name
    ),
    COALESCE(
      old_link.display_type,
      stage.place_type,
      'administrative'
    ),
    old_link.population,
    old_link.population_as_of,
    old_link.population_source,
    COALESCE(old_link.attributes, '{}'::jsonb),
    ST_Area(stage.geom::geography)
  FROM osm_city_boundary_stage AS stage
  LEFT JOIN old_city_boundary_links AS old_link
    ON old_link.osm_type = stage.osm_type
   AND old_link.osm_id = stage.osm_id
`;

const ACTIVATE_NEW_PLACES_SQL = `
  WITH candidates AS (
    SELECT
      boundary.id,
      ROW_NUMBER() OVER (
        PARTITION BY
          LOWER(REGEXP_REPLACE(boundary.display_type, '[[:space:]]+', '', 'g')),
          LOWER(REGEXP_REPLACE(boundary.display_name, '[[:space:]]+', '', 'g'))
        ORDER BY
          (boundary.osm_type = 'relation') DESC,
          boundary.area_m2 DESC,
          boundary.id
      ) AS rn
    FROM city_boundaries AS boundary
    LEFT JOIN old_city_boundary_links AS old_link
      ON old_link.osm_type = boundary.osm_type
     AND old_link.osm_id = boundary.osm_id
    WHERE old_link.osm_id IS NULL
      AND boundary.place_type IN ('city', 'town')
  )
  UPDATE city_boundaries AS boundary
  SET is_active = TRUE,
      updated_at = now()
  FROM candidates
  WHERE candidates.id = boundary.id
    AND candidates.rn = 1
    AND NOT EXISTS (
      SELECT 1
      FROM city_boundaries AS active
      WHERE active.is_active
        AND active.id <> boundary.id
        AND LOWER(REGEXP_REPLACE(active.display_type, '[[:space:]]+', '', 'g'))
            = LOWER(REGEXP_REPLACE(boundary.display_type, '[[:space:]]+', '', 'g'))
        AND LOWER(REGEXP_REPLACE(active.display_name, '[[:space:]]+', '', 'g'))
            = LOWER(REGEXP_REPLACE(boundary.display_name, '[[:space:]]+', '', 'g'))
    )
`;

const RESTORE_GEOMETRY_LINKS_SQL = `
  UPDATE city_geometries AS geometry
  SET boundary_id = boundary.id
  FROM old_geometry_boundary_links AS old_link
  JOIN city_boundaries AS boundary
    ON boundary.osm_type = old_link.osm_type
   AND boundary.osm_id = old_link.osm_id
  WHERE geometry.id = old_link.geometry_id
`;

const INSERT_RUN_SQL = `
  INSERT INTO osm_city_update_runs (
    source_url,
    checksum,
    downloaded_bytes,
    source_elements,
    imported_cities,
    ignored_elements,
    osm_timestamp,
    city_places,
    town_places,
    duplicate_names,
    administrative_places,
    duplicate_index_objects,
    batch_size,
    batch_count
  )
  VALUES (
    $1, $2, $3, $4, $5, $6, $7::timestamptz,
    $8, $9, $10, $11, $12, $13, $14
  )
  RETURNING id::integer AS id, created_at AS "createdAt"
`;

async function assertValidStage(client) {
  const invalidResult = await client.query(INVALID_STAGE_SQL);
  if (invalidResult.rows.length > 0) {
    const names = invalidResult.rows.map((row) => row.name).join(', ');
    throw new OsmCityGeometryError(
      `OSM way geometry does not form a valid place polygon: ${names}`,
    );
  }
}

export function createOsmBoundaryUpdateRepository() {
  return {
    async dropStage(client) {
      await client.query(DROP_STAGE_SQL);
    },

    async createStage(client) {
      await client.query(CREATE_STAGE_SQL);
    },

    async materializeCheckpointStage(client, checkpointId) {
      await client.query(MATERIALIZE_CHECKPOINT_STAGE_SQL, [checkpointId]);
    },

    async stageBatch(client, places, batchNumber) {
      const result = await client.query(INSERT_STAGE_SQL, [
        JSON.stringify(places),
      ]);
      if (result.rowCount !== places.length) {
        throw new Error(
          `Not every OSM place in batch ${batchNumber} was staged`,
        );
      }
      await assertValidStage(client);
      return result.rowCount ?? 0;
    },

    async assertValidStage(client) {
      await assertValidStage(client);
    },

    async stageCount(client) {
      const result = await client.query(COUNT_STAGE_SQL);
      return Number(result.rows[0]?.count ?? 0);
    },

    async preserveLinks(client) {
      await client.query(PRESERVE_LINKS_SQL);
    },

    async deleteBoundaries(client) {
      await client.query('DELETE FROM city_boundaries');
    },

    async insertBoundaries(client, osmTimestamp) {
      return client.query(INSERT_BOUNDARIES_SQL, [osmTimestamp]);
    },

    async activateNewPlaces(client) {
      await client.query(ACTIVATE_NEW_PLACES_SQL);
    },

    async restoreGeometryLinks(client) {
      return client.query(RESTORE_GEOMETRY_LINKS_SQL);
    },

    async insertRun(client, values) {
      return client.query(INSERT_RUN_SQL, values);
    },
  };
}
