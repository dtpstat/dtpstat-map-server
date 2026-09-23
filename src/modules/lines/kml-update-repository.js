const CREATE_MATCH_GEOMETRIES_SQL = `
  CREATE TEMP TABLE kml_place_match_geometries ON COMMIT DROP AS
  SELECT
    id AS boundary_id,
    city_id,
    display_name,
    display_type,
    osm_type,
    CASE
      WHEN $1::double precision = 0 THEN geom
      ELSE ST_Multi(
        ST_CollectionExtract(
          ST_Buffer(geom::geography, $1::double precision)::geometry,
          3
        )
      )
    END AS geom
  FROM city_boundaries
  WHERE is_active
`;

const INDEX_MATCH_GEOMETRIES_SQL = `
  CREATE INDEX kml_place_match_geometries_geom_idx
    ON kml_place_match_geometries USING GIST (geom);
  ANALYZE kml_place_match_geometries
`;

const MATCH_GEOMETRIES_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      "inputIndex" integer,
      geometry jsonb
    )
  ),
  prepared AS (
    SELECT
      payload_rows."inputIndex",
      ST_SetSRID(
        ST_GeomFromGeoJSON(payload_rows.geometry::text),
        4326
      ) AS geom
    FROM payload_rows
  )
  SELECT
    prepared."inputIndex" AS "inputIndex",
    candidate.boundary_id AS "boundaryId",
    candidate.city_id AS "cityId",
    candidate.city_name AS "cityName",
    candidate.place_name AS "placeName",
    candidate.place_type AS "placeType",
    COALESCE(candidate.candidate_count, 0)::integer AS "candidateCount"
  FROM prepared
  LEFT JOIN LATERAL (
    SELECT
      boundary.boundary_id,
      boundary.city_id AS city_id,
      COALESCE(linked_city.name, boundary.display_name) AS city_name,
      boundary.display_name AS place_name,
      boundary.display_type AS place_type,
      count(*) OVER ()::integer AS candidate_count
    FROM kml_place_match_geometries AS boundary
    LEFT JOIN cities AS linked_city ON linked_city.id = boundary.city_id
    CROSS JOIN LATERAL (
      SELECT ST_CollectionExtract(
        ST_Intersection(prepared.geom, boundary.geom),
        2
      ) AS overlap
    ) AS intersection
    WHERE prepared.geom && boundary.geom
      AND ST_Intersects(prepared.geom, boundary.geom)
      AND ST_Length(intersection.overlap::geography) > 0
    ORDER BY
      ST_Length(intersection.overlap::geography) DESC,
      (boundary.city_id IS NOT NULL) DESC,
      ST_Area(boundary.geom::geography) ASC,
      (boundary.osm_type = 'relation') DESC,
      boundary.boundary_id ASC
    LIMIT 1
  ) AS candidate ON TRUE
  ORDER BY prepared."inputIndex"
`;

const UPSERT_MATCHED_OSM_CITIES_SQL = `
  WITH requested AS (
    SELECT DISTINCT payload."boundaryId" AS boundary_id
    FROM jsonb_to_recordset($1::jsonb) AS payload("boundaryId" bigint)
    WHERE payload."boundaryId" IS NOT NULL
  ),
  canonical AS (
    SELECT
      boundary.id AS boundary_id,
      boundary.display_name AS city_name,
      boundary.display_type AS city_type,
      boundary.osm_type,
      boundary.osm_id,
      boundary.place_type,
      boundary.admin_level
    FROM requested
    JOIN city_boundaries AS boundary ON boundary.id = requested.boundary_id
    WHERE boundary.is_active
  )
  INSERT INTO cities (
    slug,
    name,
    full_name,
    display_type,
    lane_length_m,
    attributes
  )
  SELECT
    'osm-' || canonical.osm_type || '-' || canonical.osm_id,
    canonical.city_name,
    canonical.city_name,
    canonical.city_type,
    0,
    jsonb_build_object(
      '_osm',
      jsonb_build_object(
        'osmType', canonical.osm_type,
        'osmId', canonical.osm_id,
        'placeType', canonical.place_type,
        'adminLevel', canonical.admin_level
      )
    )
  FROM canonical
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    full_name = EXCLUDED.full_name,
    display_type = EXCLUDED.display_type,
    attributes = cities.attributes || EXCLUDED.attributes,
    updated_at = now()
  RETURNING id::integer AS id, name
`;

const LINK_MATCHED_OSM_CITIES_SQL = `
  WITH requested AS (
    SELECT DISTINCT payload."boundaryId" AS boundary_id
    FROM jsonb_to_recordset($1::jsonb) AS payload("boundaryId" bigint)
    WHERE payload."boundaryId" IS NOT NULL
  )
  UPDATE city_boundaries AS boundary
  SET city_id = city.id,
      updated_at = now()
  FROM requested, cities AS city
  WHERE boundary.id = requested.boundary_id
    AND city.slug = 'osm-' || boundary.osm_type || '-' || boundary.osm_id
    AND boundary.is_active
    AND boundary.city_id IS NULL
`;

const LOAD_MATCHED_CITY_IDS_SQL = `
  WITH requested AS (
    SELECT DISTINCT payload."boundaryId" AS boundary_id
    FROM jsonb_to_recordset($1::jsonb) AS payload("boundaryId" bigint)
    WHERE payload."boundaryId" IS NOT NULL
  )
  SELECT
    boundary.id::integer AS "boundaryId",
    city.id::integer AS id,
    city.name
  FROM requested
  JOIN city_boundaries AS boundary ON boundary.id = requested.boundary_id
  JOIN cities AS city ON city.id = boundary.city_id
  ORDER BY boundary.id
`;

const INSERT_MISSING_LINE_TYPES_SQL = `
  WITH requested AS (
    SELECT DISTINCT BTRIM(name) AS name
    FROM unnest($1::text[]) AS requested(name)
  )
  INSERT INTO line_types (name, title)
  SELECT requested.name, requested.name
  FROM requested
  WHERE NOT EXISTS (
    SELECT 1
    FROM line_types AS existing
    WHERE LOWER(BTRIM(existing.name)) = LOWER(BTRIM(requested.name))
  )
  ON CONFLICT DO NOTHING
  RETURNING
    id::integer AS id,
    code::integer AS code,
    name,
    title,
    color,
    line_style AS style,
    width::double precision AS width
`;

const LOAD_LINE_TYPES_SQL = `
  WITH requested AS (
    SELECT DISTINCT BTRIM(name) AS name
    FROM unnest($1::text[]) AS requested(name)
  )
  SELECT
    requested.name AS "requestedName",
    line_type.id::integer AS id,
    line_type.code::integer AS code,
    line_type.name,
    line_type.title,
    line_type.color,
    line_type.line_style AS style,
    line_type.width::double precision AS width
  FROM requested
  JOIN line_types AS line_type
    ON LOWER(BTRIM(line_type.name)) = LOWER(BTRIM(requested.name))
  ORDER BY line_type.code
`;

const INSERT_GEOMETRIES_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      "cityId" bigint,
      "boundaryId" bigint,
      "lineTypeId" bigint,
      multiple smallint,
      properties jsonb,
      geometry jsonb
    )
  ),
  prepared AS (
    SELECT
      payload_rows.*,
      ST_SetSRID(
        ST_GeomFromGeoJSON(payload_rows.geometry::text),
        4326
      ) AS geom
    FROM payload_rows
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
    prepared."cityId",
    prepared."boundaryId",
    prepared."lineTypeId",
    prepared.multiple,
    ST_Length(prepared.geom::geography),
    ST_Length(prepared.geom::geography) * prepared.multiple,
    prepared.properties,
    prepared.geom
  FROM prepared
`;

const INSERT_UPDATE_RUN_SQL = `
  INSERT INTO geometry_update_runs (
    sources,
    checksum,
    downloaded_bytes,
    parsed_lines,
    imported_geometries,
    skipped_without_city,
    resolved_ambiguous,
    ignored_non_lines,
    city_buffer_m
  )
  VALUES ($1::jsonb, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING id::integer AS id, created_at AS "createdAt"
`;

export function createKmlUpdateRepository() {
  return {
    loadLineTypes(client, names) {
      return client.query(LOAD_LINE_TYPES_SQL, [names]);
    },

    insertMissingLineTypes(client, names) {
      return client.query(INSERT_MISSING_LINE_TYPES_SQL, [names]);
    },

    boundariesReady(client) {
      return client.query(
        'SELECT EXISTS (SELECT 1 FROM city_boundaries WHERE is_active) AS ready',
      );
    },

    async prepareMatchGeometries(client, cityBufferMeters) {
      await client.query(CREATE_MATCH_GEOMETRIES_SQL, [
        cityBufferMeters,
      ]);
      await client.query(INDEX_MATCH_GEOMETRIES_SQL);
    },

    matchGeometries(client, payload) {
      return client.query(
        MATCH_GEOMETRIES_SQL,
        [JSON.stringify(payload)],
      );
    },

    upsertMatchedCities(client, payload) {
      return client.query(
        UPSERT_MATCHED_OSM_CITIES_SQL,
        [JSON.stringify(payload)],
      );
    },

    linkMatchedCities(client, payload) {
      return client.query(
        LINK_MATCHED_OSM_CITIES_SQL,
        [JSON.stringify(payload)],
      );
    },

    loadMatchedCityIds(client, payload) {
      return client.query(
        LOAD_MATCHED_CITY_IDS_SQL,
        [JSON.stringify(payload)],
      );
    },

    clearGeometries(client) {
      return client.query('DELETE FROM city_geometries');
    },

    insertGeometries(client, payload) {
      return client.query(
        INSERT_GEOMETRIES_SQL,
        [JSON.stringify(payload)],
      );
    },

    insertUpdateRun(client, values) {
      return client.query(INSERT_UPDATE_RUN_SQL, values);
    },
  };
}
