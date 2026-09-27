const UPSERT_CITIES_SQL = `
  INSERT INTO cities (
    slug,
    name,
    full_name,
    display_type,
    lane_length_m,
    attributes
  )
  SELECT
    payload.slug,
    payload.name,
    payload."fullName",
    payload."displayType",
    0,
    payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    slug text,
    name text,
    "fullName" text,
    "displayType" text,
    attributes jsonb
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    full_name = EXCLUDED.full_name,
    display_type = EXCLUDED.display_type,
    attributes = EXCLUDED.attributes,
    updated_at = now()
`;

const CREATE_STAGE_SQL = `
  CREATE TEMP TABLE city_boundary_transfer_stage (
    place_type text,
    admin_level smallint,
    active boolean NOT NULL,
    display_name text NOT NULL,
    display_type text NOT NULL,
    osm_type text NOT NULL,
    osm_id bigint NOT NULL,
    osm_name text NOT NULL,
    tags jsonb NOT NULL,
    osm_timestamp timestamptz,
    updated_at timestamptz,
    population integer,
    population_as_of date,
    population_source text,
    attributes jsonb NOT NULL,
    city_slug text,
    city_name text,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    bounds geometry(Polygon, 4326) NOT NULL,
    area_m2 double precision NOT NULL,
    PRIMARY KEY (osm_type, osm_id)
  ) ON COMMIT DROP
`;

const INSERT_STAGE_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      "placeType" text,
      "adminLevel" smallint,
      active boolean,
      "displayName" text,
      "displayType" text,
      "osmType" text,
      "osmId" bigint,
      "osmName" text,
      tags jsonb,
      "osmTimestamp" timestamptz,
      "updatedAt" timestamptz,
      population integer,
      "populationAsOf" date,
      "populationSource" text,
      attributes jsonb,
      "citySlug" text,
      "cityName" text,
      geometry jsonb
    )
  ),
  prepared AS (
    SELECT
      payload_rows.*,
      ST_Multi(
        ST_CollectionExtract(
          ST_SetSRID(ST_GeomFromGeoJSON(payload_rows.geometry::text), 4326),
          3
        )
      ) AS geom
    FROM payload_rows
  ),
  measured AS (
    SELECT
      prepared.*,
      ST_Area(prepared.geom::geography) AS area_m2
    FROM prepared
  )
  INSERT INTO city_boundary_transfer_stage (
    place_type,
    admin_level,
    active,
    display_name,
    display_type,
    osm_type,
    osm_id,
    osm_name,
    tags,
    osm_timestamp,
    updated_at,
    population,
    population_as_of,
    population_source,
    attributes,
    city_slug,
    city_name,
    geom,
    bounds,
    area_m2
  )
  SELECT
    "placeType",
    "adminLevel",
    active,
    "displayName",
    "displayType",
    "osmType",
    "osmId",
    "osmName",
    tags,
    "osmTimestamp",
    "updatedAt",
    population,
    "populationAsOf",
    "populationSource",
    attributes,
    "citySlug",
    "cityName",
    geom,
    ST_Envelope(geom),
    area_m2
  FROM measured
`;

const INVALID_STAGE_SQL = `
  SELECT osm_type, osm_id, osm_name
  FROM city_boundary_transfer_stage
  WHERE ST_IsEmpty(geom)
     OR NOT ST_IsValid(geom)
     OR area_m2 <= 0
  ORDER BY osm_type, osm_id
`;

const PRESERVE_GEOMETRY_LINKS_SQL = `
  CREATE TEMP TABLE old_transfer_geometry_links ON COMMIT DROP AS
  SELECT geometry.id AS geometry_id, boundary.osm_type, boundary.osm_id
  FROM city_geometries AS geometry
  JOIN city_boundaries AS boundary ON boundary.id = geometry.boundary_id
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
    updated_at,
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
    COALESCE(
      (SELECT city.id FROM cities AS city WHERE city.slug = stage.city_slug LIMIT 1),
      (
        SELECT MIN(city.id)
        FROM cities AS city
        WHERE city.name = stage.city_name
        HAVING COUNT(*) = 1
      )
    ),
    stage.place_type,
    stage.admin_level,
    stage.osm_type,
    stage.osm_id,
    stage.osm_name,
    stage.tags,
    stage.geom,
    stage.bounds,
    stage.osm_timestamp,
    COALESCE(stage.updated_at, now()),
    stage.active,
    stage.display_name,
    stage.display_type,
    stage.population,
    stage.population_as_of,
    stage.population_source,
    stage.attributes,
    stage.area_m2
  FROM city_boundary_transfer_stage AS stage
  ORDER BY stage.osm_type, stage.osm_id
`;

const RESTORE_GEOMETRY_LINKS_SQL = `
  UPDATE city_geometries AS geometry
  SET boundary_id = boundary.id
  FROM old_transfer_geometry_links AS old_link
  JOIN city_boundaries AS boundary
    ON boundary.osm_type = old_link.osm_type
   AND boundary.osm_id = old_link.osm_id
  WHERE geometry.id = old_link.geometry_id
`;

const LINKED_CITY_COUNT_SQL = `
  SELECT count(*)::integer AS count
  FROM city_boundaries
  WHERE city_id IS NOT NULL
`;

export function createCityBoundaryTransferRepository() {
  return {
    createStage(client) {
      return client.query(CREATE_STAGE_SQL);
    },

    insertStageBatch(client, boundaries) {
      return client.query(INSERT_STAGE_SQL, [JSON.stringify(boundaries)]);
    },

    upsertCities(client, cities) {
      return client.query(UPSERT_CITIES_SQL, [JSON.stringify(cities)]);
    },

    findInvalidStage(client) {
      return client.query(INVALID_STAGE_SQL);
    },

    preserveGeometryLinks(client) {
      return client.query(PRESERVE_GEOMETRY_LINKS_SQL);
    },

    deleteBoundaries(client) {
      return client.query('DELETE FROM city_boundaries');
    },

    insertBoundaries(client) {
      return client.query(INSERT_BOUNDARIES_SQL);
    },

    restoreGeometryLinks(client) {
      return client.query(RESTORE_GEOMETRY_LINKS_SQL);
    },

    linkedCityCount(client) {
      return client.query(LINKED_CITY_COUNT_SQL);
    },
  };
}
