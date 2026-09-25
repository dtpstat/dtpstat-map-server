import {
  RECALCULATE_CITY_STATISTICS_SQL,
} from './recalculate-city-statistics.js';

const FAMILY_SQL = `
  CASE
    WHEN GeometryType(geometry.geom) = 'POINT' THEN 'point'
    WHEN GeometryType(geometry.geom) IN ('LINESTRING', 'MULTILINESTRING') THEN 'line'
    WHEN GeometryType(geometry.geom) IN ('POLYGON', 'MULTIPOLYGON') THEN 'polygon'
    ELSE 'unsupported'
  END
`;

const DETAIL_COLUMNS_SQL = `
  geometry.id::integer AS id,
  geometry.city_id::integer AS "cityId",
  geometry.boundary_id::integer AS "boundaryId",
  ${FAMILY_SQL} AS family,
  GeometryType(geometry.geom) AS "geometryType",
  geometry.display_name AS "displayName",
  geometry.tooltip,
  geometry.tags,
  geometry.source_tags AS "sourceTags",
  geometry.is_visible AS "isVisible",
  geometry.was_edited AS "wasEdited",
  geometry.line_type_id::integer AS "lineTypeId",
  line_type.code::integer AS "lineTypeCode",
  line_type.name AS "lineTypeName",
  line_type.title AS "lineTypeTitle",
  line_type.color AS "lineTypeColor",
  line_type.line_style AS "lineTypeStyle",
  line_type.width::double precision AS "lineTypeWidth",
  geometry.lanes,
  geometry.length_m AS "lengthMeters",
  geometry.lane_length_m AS "laneLengthMeters",
  CASE
    WHEN GeometryType(geometry.geom) IN ('POLYGON', 'MULTIPOLYGON')
      THEN ST_Perimeter(geometry.geom::geography)
    ELSE NULL
  END::double precision AS "perimeterMeters",
  CASE
    WHEN GeometryType(geometry.geom) IN ('POLYGON', 'MULTIPOLYGON')
      THEN ST_Area(geometry.geom::geography)
    ELSE NULL
  END::double precision AS "areaSquareMeters",
  ST_AsGeoJSON(geometry.geom)::json AS geometry,
  geometry.created_at AS "createdAt",
  geometry.updated_at AS "updatedAt"
`;

const ACTIVE_BOUNDARY_LINK_STATE_SQL = `
  SELECT
    COUNT(*)::integer AS "activeBoundaries",
    COUNT(*) FILTER (WHERE city_id IS NULL)::integer AS "unlinkedBoundaries"
  FROM city_boundaries
  WHERE is_active
`;

const CITIES_SQL = `
  SELECT
    city.id::integer AS id,
    city.name,
    city.full_name AS "fullName",
    (
      SELECT COUNT(*)::integer
      FROM city_geometries AS geometry_count
      WHERE geometry_count.city_id = city.id
    ) AS "geometryCount"
  FROM cities AS city
  WHERE EXISTS (
    SELECT 1
    FROM city_boundaries AS boundary
    WHERE boundary.city_id = city.id
      AND boundary.is_active
  )
    AND EXISTS (
      SELECT 1
      FROM city_geometries AS geometry_presence
      WHERE geometry_presence.city_id = city.id
    )
  ORDER BY city.name, city.id
`;

const CITY_SQL = `
  SELECT
    city.id::integer AS id,
    city.slug,
    city.name,
    city.full_name AS "fullName",
    boundary.id::integer AS "boundaryId",
    json_build_array(
      ST_XMin(boundary.bounds),
      ST_YMin(boundary.bounds),
      ST_XMax(boundary.bounds),
      ST_YMax(boundary.bounds)
    ) AS bounds,
    json_build_array(
      ST_X(ST_PointOnSurface(boundary.geom)),
      ST_Y(ST_PointOnSurface(boundary.geom))
    ) AS center,
    ST_AsGeoJSON(boundary.geom)::json AS "boundaryGeometry"
  FROM cities AS city
  JOIN city_boundaries AS boundary
    ON boundary.city_id = city.id
   AND boundary.is_active
  WHERE city.id = $1
  LIMIT 1
`;

const GEOMETRY_SUMMARIES_SQL = `
  SELECT
    geometry.id::integer AS id,
    geometry.city_id::integer AS "cityId",
    geometry.boundary_id::integer AS "boundaryId",
    ${FAMILY_SQL} AS family,
    GeometryType(geometry.geom) AS "geometryType",
    geometry.display_name AS "displayName",
    geometry.is_visible AS "isVisible",
    geometry.updated_at AS "updatedAt",
    line_type.name AS "lineTypeName",
    line_type.color AS "lineTypeColor",
    line_type.width::double precision AS "lineTypeWidth",
    ST_AsGeoJSON(geometry.geom)::json AS geometry
  FROM city_geometries AS geometry
  LEFT JOIN line_types AS line_type
    ON line_type.id = geometry.line_type_id
  WHERE geometry.city_id = $1
  ORDER BY
    COALESCE(NULLIF(BTRIM(geometry.display_name), ''), ''),
    geometry.id
`;

const ONE_GEOMETRY_SQL = `
  SELECT
    ${DETAIL_COLUMNS_SQL}
  FROM city_geometries AS geometry
  LEFT JOIN line_types AS line_type
    ON line_type.id = geometry.line_type_id
  WHERE geometry.id = $1
`;

const LOCK_GEOMETRIES_SQL = `
  SELECT
    ${DETAIL_COLUMNS_SQL}
  FROM city_geometries AS geometry
  LEFT JOIN line_types AS line_type
    ON line_type.id = geometry.line_type_id
  WHERE geometry.id = ANY($1::bigint[])
  ORDER BY geometry.id
  FOR UPDATE OF geometry
`;

const CREATE_GEOMETRY_SQL = `
  WITH prepared AS (
    SELECT
      ST_SetSRID(
        ST_GeomFromGeoJSON($3::text),
        4326
      ) AS geom
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
    tooltip,
    tags,
    source_tags,
    is_visible,
    was_edited,
    updated_at
  )
  SELECT
    $1,
    $2,
    $4,
    $5,
    CASE
      WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
        THEN ST_Length(prepared.geom::geography)
      ELSE NULL
    END,
    CASE
      WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
        THEN ST_Length(prepared.geom::geography) * $5::smallint
      ELSE NULL
    END,
    jsonb_build_object('source', 'manual'),
    prepared.geom,
    $6,
    $7,
    $8::text[],
    '{}'::jsonb,
    $9,
    TRUE,
    NOW()
  FROM prepared
  WHERE NOT ST_IsEmpty(prepared.geom)
    AND ST_IsValid(prepared.geom)
  RETURNING id::integer AS id
`;

const UPDATE_GEOMETRY_SQL = `
  WITH prepared AS (
    SELECT
      ST_SetSRID(
        ST_GeomFromGeoJSON($2::text),
        4326
      ) AS geom
  )
  UPDATE city_geometries AS geometry
  SET
    geom = prepared.geom,
    line_type_id = $3,
    lanes = $4,
    length_m = CASE
      WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
        THEN ST_Length(prepared.geom::geography)
      ELSE NULL
    END,
    lane_length_m = CASE
      WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
        THEN ST_Length(prepared.geom::geography) * $4::smallint
      ELSE NULL
    END,
    display_name = $5,
    tooltip = $6,
    tags = $7::text[],
    is_visible = $8,
    was_edited = TRUE,
    updated_at = NOW()
  FROM prepared
  WHERE geometry.id = $1
    AND NOT ST_IsEmpty(prepared.geom)
    AND ST_IsValid(prepared.geom)
  RETURNING geometry.id::integer AS id
`;

export function createGeometryEditorStorage(
  database,
) {
  const one =
    async (
      queryable,
      geometryId,
    ) => {
      const result =
        await queryable.query(
          ONE_GEOMETRY_SQL,
          [geometryId],
        );
      return result.rows[0] ?? null;
    };

  return {
    async boundaryLinkState(
      queryable = database,
    ) {
      const result =
        await queryable.query(
          ACTIVE_BOUNDARY_LINK_STATE_SQL,
        );
      return (
        result.rows[0] ?? {
          activeBoundaries: 0,
          unlinkedBoundaries: 0,
        }
      );
    },

    syncActiveBoundaryCities(
      client,
    ) {
      return client.query(
        'SELECT sync_active_boundary_cities()',
      );
    },

    async listCities() {
      const result =
        await database.query(
          CITIES_SQL,
        );
      return result.rows;
    },

    async getCity(cityId) {
      const result =
        await database.query(
          CITY_SQL,
          [cityId],
        );
      return result.rows[0] ?? null;
    },

    async listCityGeometries(
      cityId,
    ) {
      const result =
        await database.query(
          GEOMETRY_SUMMARIES_SQL,
          [cityId],
        );
      return result.rows;
    },

    getGeometry(
      queryable,
      geometryId,
    ) {
      return one(
        queryable,
        geometryId,
      );
    },

    async lockGeometries(
      client,
      ids,
    ) {
      const result =
        await client.query(
          LOCK_GEOMETRIES_SQL,
          [ids],
        );
      return result.rows;
    },

    async activeBoundaryForCity(
      client,
      cityId,
    ) {
      const result =
        await client.query(
          `SELECT
             boundary.id::integer AS id
           FROM city_boundaries AS boundary
           WHERE boundary.city_id = $1
             AND boundary.is_active
           ORDER BY boundary.id
           LIMIT 1
           FOR SHARE`,
          [cityId],
        );
      return result.rows[0] ?? null;
    },

    async lineTypeExists(
      queryable,
      lineTypeId,
    ) {
      if (lineTypeId === null) {
        return true;
      }
      const result =
        await queryable.query(
          'SELECT 1 FROM line_types WHERE id = $1',
          [lineTypeId],
        );
      return Boolean(
        result.rows[0],
      );
    },

    async createGeometry(
      client,
      payload,
      boundaryId,
    ) {
      const result =
        await client.query(
          CREATE_GEOMETRY_SQL,
          [
            payload.cityId,
            boundaryId,
            JSON.stringify(
              payload.geometry,
            ),
            payload.lineTypeId,
            payload.lanes,
            payload.displayName,
            payload.tooltip,
            payload.tags,
            payload.isVisible,
          ],
        );

      const id =
        result.rows[0]?.id;
      return id
        ? one(client, id)
        : null;
    },

    async updateGeometry(
      client,
      geometryId,
      payload,
    ) {
      const result =
        await client.query(
          UPDATE_GEOMETRY_SQL,
          [
            geometryId,
            JSON.stringify(
              payload.geometry,
            ),
            payload.lineTypeId,
            payload.lanes,
            payload.displayName,
            payload.tooltip,
            payload.tags,
            payload.isVisible,
          ],
        );

      return result.rows[0]
        ? one(
          client,
          geometryId,
        )
        : null;
    },

    async deleteGeometry(
      client,
      geometryId,
    ) {
      await client.query(
        'DELETE FROM city_geometries WHERE id = $1',
        [geometryId],
      );
    },

    assertNoPendingImport(
      client,
    ) {
      return client.query(
        'SELECT assert_no_pending_geometry_import()',
      );
    },

    assertInvariants(client) {
      return client.query(
        'SELECT assert_city_geometry_invariants()',
      );
    },

    async recalculateDerived(
      client,
    ) {
      await client.query(
        'SELECT sync_active_boundary_cities()',
      );
      await client.query(
        'SELECT assert_city_geometry_invariants()',
      );
      const statistics =
        await client.query(
          RECALCULATE_CITY_STATISTICS_SQL,
        );
      return {
        cities:
          statistics.rowCount,
      };
    },
  };
}
