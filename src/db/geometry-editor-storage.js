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
  (geometry.boundary_id IS NULL) AS suspended,
  (
    geometry.city_id IS NULL
    AND geometry.boundary_id IS NULL
  ) AS unlinked,
  ${FAMILY_SQL} AS family,
  GeometryType(geometry.geom) AS "geometryType",
  geometry.display_name AS "displayName",
  geometry.tooltip,
  geometry.tags,
  geometry.source_tags AS "sourceTags",
  geometry.is_visible AS "isVisible",
  geometry.was_edited AS "wasEdited",
  geometry.line_type_id::integer AS "lineTypeId",
  geometry.point_type_id::integer AS "pointTypeId",
  point_type.name AS "pointTypeName",
  point_type.is_active AS "pointTypeActive",
  point_type.display_width::integer AS "pointTypeDisplayWidth",
  point_type.display_height::integer AS "pointTypeDisplayHeight",
  point_type.anchor_x::double precision AS "pointTypeAnchorX",
  point_type.anchor_y::double precision AS "pointTypeAnchorY",
  (point_type.icon_file_name IS NOT NULL) AS "pointTypeIconConfigured",
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
      SELECT boundary.id::integer
      FROM city_boundaries AS boundary
      WHERE boundary.city_id = city.id
        AND boundary.is_active
      ORDER BY boundary.id
      LIMIT 1
    ) AS "activeBoundaryId",
    (
      SELECT COUNT(*)::integer
      FROM city_geometries AS geometry_count
      WHERE geometry_count.city_id = city.id
    ) AS "geometryCount",
    (
      SELECT COUNT(*)::integer
      FROM city_geometries AS suspended_geometry
      WHERE suspended_geometry.city_id = city.id
        AND suspended_geometry.boundary_id IS NULL
    ) AS "suspendedGeometryCount"
  FROM cities AS city
  WHERE EXISTS (
    SELECT 1
    FROM city_boundaries AS boundary
    WHERE boundary.city_id = city.id
      AND boundary.is_active
  )
     OR EXISTS (
       SELECT 1
       FROM city_geometries AS geometry_presence
       WHERE geometry_presence.city_id = city.id
     )
  ORDER BY
    (EXISTS (
      SELECT 1
      FROM city_boundaries AS boundary
      WHERE boundary.city_id = city.id
        AND boundary.is_active
    )) DESC,
    city.name,
    city.id
`;

const CITY_SQL = `
  SELECT
    city.id::integer AS id,
    city.slug,
    city.name,
    city.full_name AS "fullName",
    boundary.id::integer AS "boundaryId",
    CASE
      WHEN boundary.id IS NULL THEN NULL
      ELSE json_build_array(
        ST_XMin(boundary.bounds),
        ST_YMin(boundary.bounds),
        ST_XMax(boundary.bounds),
        ST_YMax(boundary.bounds)
      )
    END AS bounds,
    CASE
      WHEN boundary.id IS NULL THEN NULL
      ELSE json_build_array(
        ST_X(ST_PointOnSurface(boundary.geom)),
        ST_Y(ST_PointOnSurface(boundary.geom))
      )
    END AS center,
    CASE
      WHEN boundary.id IS NULL THEN NULL
      ELSE ST_AsGeoJSON(boundary.geom)::json
    END AS "boundaryGeometry"
  FROM cities AS city
  LEFT JOIN LATERAL (
    SELECT
      candidate.id,
      candidate.bounds,
      candidate.geom
    FROM city_boundaries AS candidate
    WHERE candidate.city_id = city.id
      AND candidate.is_active
    ORDER BY candidate.id
    LIMIT 1
  ) AS boundary
    ON TRUE
  WHERE city.id = $1::bigint
  LIMIT 1
`;

const GEOMETRY_SUMMARIES_SQL = `
  SELECT
    geometry.id::integer AS id,
    geometry.city_id::integer AS "cityId",
    geometry.boundary_id::integer AS "boundaryId",
    (geometry.boundary_id IS NULL) AS suspended,
    ${FAMILY_SQL} AS family,
    GeometryType(geometry.geom) AS "geometryType",
    geometry.display_name AS "displayName",
    geometry.is_visible AS "isVisible",
    geometry.updated_at AS "updatedAt",
    geometry.line_type_id::integer AS "lineTypeId",
    geometry.point_type_id::integer AS "pointTypeId",
    point_type.name AS "pointTypeName",
    point_type.is_active AS "pointTypeActive",
    point_type.display_width::integer AS "pointTypeDisplayWidth",
    point_type.display_height::integer AS "pointTypeDisplayHeight",
    point_type.anchor_x::double precision AS "pointTypeAnchorX",
    point_type.anchor_y::double precision AS "pointTypeAnchorY",
    (point_type.icon_file_name IS NOT NULL) AS "pointTypeIconConfigured",
    geometry.lanes,
    line_type.name AS "lineTypeName",
    line_type.color AS "lineTypeColor",
    line_type.width::double precision AS "lineTypeWidth",
    ST_AsGeoJSON(geometry.geom)::json AS geometry
  FROM city_geometries AS geometry
  LEFT JOIN line_types AS line_type
    ON line_type.id = geometry.line_type_id
  LEFT JOIN point_types AS point_type
    ON point_type.id = geometry.point_type_id
  WHERE geometry.city_id = $1::bigint
  ORDER BY
    COALESCE(NULLIF(BTRIM(geometry.display_name), ''), ''),
    geometry.id
`;

const UNLINKED_GEOMETRY_SUMMARIES_SQL = `
  SELECT
    geometry.id::integer AS id,
    geometry.city_id::integer AS "cityId",
    geometry.boundary_id::integer AS "boundaryId",
    (geometry.boundary_id IS NULL) AS suspended,
    (
      geometry.city_id IS NULL
      AND geometry.boundary_id IS NULL
    ) AS unlinked,
    ${FAMILY_SQL} AS family,
    GeometryType(geometry.geom) AS "geometryType",
    geometry.display_name AS "displayName",
    geometry.is_visible AS "isVisible",
    geometry.updated_at AS "updatedAt",
    geometry.line_type_id::integer AS "lineTypeId",
    geometry.point_type_id::integer AS "pointTypeId",
    point_type.name AS "pointTypeName",
    point_type.is_active AS "pointTypeActive",
    point_type.display_width::integer AS "pointTypeDisplayWidth",
    point_type.display_height::integer AS "pointTypeDisplayHeight",
    point_type.anchor_x::double precision AS "pointTypeAnchorX",
    point_type.anchor_y::double precision AS "pointTypeAnchorY",
    (point_type.icon_file_name IS NOT NULL) AS "pointTypeIconConfigured",
    geometry.lanes,
    line_type.name AS "lineTypeName",
    line_type.color AS "lineTypeColor",
    line_type.width::double precision AS "lineTypeWidth",
    ST_AsGeoJSON(geometry.geom)::json AS geometry
  FROM city_geometries AS geometry
  LEFT JOIN line_types AS line_type
    ON line_type.id = geometry.line_type_id
  LEFT JOIN point_types AS point_type
    ON point_type.id = geometry.point_type_id
  WHERE geometry.city_id IS NULL
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
  LEFT JOIN point_types AS point_type
    ON point_type.id = geometry.point_type_id
  WHERE geometry.id = $1::bigint
`;

const LOCK_GEOMETRIES_SQL = `
  SELECT
    ${DETAIL_COLUMNS_SQL}
  FROM city_geometries AS geometry
  LEFT JOIN line_types AS line_type
    ON line_type.id = geometry.line_type_id
  LEFT JOIN point_types AS point_type
    ON point_type.id = geometry.point_type_id
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
    point_type_id,
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
    $1::bigint,
    $2::bigint,
    $4::bigint,
    $5::bigint,
    $6::smallint,
    CASE
      WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
        THEN ST_Length(prepared.geom::geography)
      ELSE NULL
    END,
    CASE
      WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
        THEN ST_Length(prepared.geom::geography) * $6::smallint
      ELSE NULL
    END,
    jsonb_build_object('source', 'manual'),
    prepared.geom,
    $7::text,
    $8::text,
    $9::text[],
    '{}'::jsonb,
    $10::boolean,
    TRUE,
    NOW()
  FROM prepared
  WHERE NOT ST_IsEmpty(prepared.geom)
    AND ST_IsValid(prepared.geom)
  RETURNING id::integer AS id
`;

const CREATE_GEOMETRY_FROM_SOURCE_SQL = `
  WITH prepared AS (
    SELECT
      ST_SetSRID(
        ST_GeomFromGeoJSON(
          $2::text
        ),
        4326
      ) AS geom
  )
  INSERT INTO city_geometries (
    city_id,
    boundary_id,
    line_type_id,
    point_type_id,
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
    source.city_id,
    source.boundary_id,
    $3::bigint,
    $4::bigint,
    $5::smallint,
    CASE
      WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
        THEN ST_Length(
          prepared.geom::geography
        )
      ELSE NULL
    END,
    CASE
      WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
        THEN ST_Length(
          prepared.geom::geography
        ) * $5::smallint
      ELSE NULL
    END,
    source.properties,
    prepared.geom,
    $6::text,
    $7::text,
    $8::text[],
    source.source_tags,
    $9::boolean,
    TRUE,
    NOW()
  FROM city_geometries AS source
  CROSS JOIN prepared
  WHERE source.id = $1::bigint
    AND NOT ST_IsEmpty(
      prepared.geom
    )
    AND ST_IsValid(
      prepared.geom
    )
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
    line_type_id = $3::bigint,
    point_type_id = $4::bigint,
    lanes = $5::smallint,
    length_m = CASE
      WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
        THEN ST_Length(prepared.geom::geography)
      ELSE NULL
    END,
    lane_length_m = CASE
      WHEN GeometryType(prepared.geom) IN ('LINESTRING', 'MULTILINESTRING')
        THEN ST_Length(prepared.geom::geography) * $5::smallint
      ELSE NULL
    END,
    display_name = $6::text,
    tooltip = $7::text,
    tags = $8::text[],
    is_visible = $9::boolean,
    was_edited = TRUE,
    updated_at = NOW()
  FROM prepared
  WHERE geometry.id = $1::bigint
    AND NOT ST_IsEmpty(prepared.geom)
    AND ST_IsValid(prepared.geom)
  RETURNING geometry.id::integer AS id
`;

const UNION_GEOMETRY_PREVIEW_SQL = `
  WITH input AS (
    SELECT
      ST_SetSRID(
        ST_GeomFromGeoJSON(
          item.value::text
        ),
        4326
      ) AS geom
    FROM jsonb_array_elements(
      $1::jsonb
    ) AS item(value)
  ),
  merged AS (
    SELECT CASE
      WHEN $2::text = 'line' THEN
        ST_RemoveRepeatedPoints(
          ST_LineMerge(
            ST_CollectionExtract(
              ST_UnaryUnion(
                ST_Collect(geom)
              ),
              2
            )
          ),
          0.0
        )
      ELSE
        ST_Multi(
          ST_CollectionExtract(
            ST_MakeValid(
              ST_UnaryUnion(
                ST_Collect(geom)
              )
            ),
            3
          )
        )
    END AS geom
    FROM input
  )
  SELECT
    ST_AsGeoJSON(
      merged.geom
    )::json AS geometry
  FROM merged
  WHERE NOT ST_IsEmpty(
      merged.geom
    )
    AND ST_IsValid(
      merged.geom
    )
`;

const CUT_GEOMETRY_PREVIEW_SQL = `const CUT_GEOMETRY_PREVIEW_SQL = `
  WITH source AS (
    SELECT
      ST_SetSRID(
        ST_GeomFromGeoJSON(
          $1::text
        ),
        4326
      ) AS geom
  ),
  cutter AS (
    SELECT
      ST_SetSRID(
        ST_GeomFromGeoJSON(
          $2::text
        ),
        4326
      ) AS geom
  ),
  difference AS (
    SELECT
      ST_Multi(
        ST_CollectionExtract(
          ST_MakeValid(
            ST_Difference(
              source.geom,
              cutter.geom
            )
          ),
          3
        )
      ) AS geom,
      source.geom AS source_geom
    FROM source
    CROSS JOIN cutter
  )
  SELECT
    ST_AsGeoJSON(
      difference.geom
    )::json AS geometry
  FROM difference
  WHERE NOT ST_IsEmpty(
      difference.geom
    )
    AND ST_IsValid(
      difference.geom
    )
    AND NOT ST_Equals(
      difference.geom,
      difference.source_geom
    )
`;

const SPLIT_GEOMETRY_PREVIEW_SQL = `
  WITH source AS (
    SELECT
      ST_SetSRID(
        ST_GeomFromGeoJSON(
          $1::text
        ),
        4326
      ) AS geom
  ),
  parsed_blade AS (
    SELECT
      ST_SetSRID(
        ST_GeomFromGeoJSON(
          $2::text
        ),
        4326
      ) AS blade
  ),
  prepared AS (
    SELECT
      ST_LineExtend(
        parsed_blade.blade,
        360.0,
        360.0
      ) AS blade
    FROM parsed_blade
  ),
  split_result AS (
    SELECT
      ST_Split(
        source.geom,
        prepared.blade
      ) AS pieces
    FROM source
    CROSS JOIN prepared
  ),
  dumped AS MATERIALIZED (
    SELECT
      dump.path,
      dump.geom
    FROM split_result
    CROSS JOIN LATERAL ST_Dump(
      ST_CollectionExtract(
        split_result.pieces,
        CASE
          WHEN $3::text = 'line'
            THEN 2
          ELSE 3
        END
      )
    ) AS dump
    WHERE NOT ST_IsEmpty(
      dump.geom
    )
      AND ST_IsValid(
        dump.geom
      )
  ),
  numbered AS (
    SELECT
      geom,
      ROW_NUMBER() OVER (
        ORDER BY path
      ) AS part_no,
      COUNT(*) OVER () AS part_count
    FROM dumped
  )
  SELECT
    ST_AsGeoJSON(
      geom
    )::json AS geometry
  FROM numbered
  WHERE part_count = 2
  ORDER BY part_no
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

    async listUnlinkedGeometries() {
      const result =
        await database.query(
          UNLINKED_GEOMETRY_SUMMARIES_SQL,
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
           WHERE boundary.city_id = $1::bigint
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
          'SELECT 1 FROM line_types WHERE id = $1::bigint',
          [lineTypeId],
        );
      return Boolean(
        result.rows[0],
      );
    },

    async pointTypeExists(
      queryable,
      pointTypeId,
    ) {
      if (pointTypeId === null) {
        return true;
      }
      const result =
        await queryable.query(
          'SELECT 1 FROM point_types WHERE id = $1::bigint',
          [pointTypeId],
        );
      return Boolean(
        result.rows[0],
      );
    },

    async createGeometry(
      client,
      payload,
    ) {
      const result =
        await client.query(
          CREATE_GEOMETRY_SQL,
          [
            null,
            null,
            JSON.stringify(
              payload.geometry,
            ),
            payload.lineTypeId,
            payload.pointTypeId,
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

    async createGeometryFromSource(
      client,
      sourceGeometryId,
      payload,
    ) {
      const result =
        await client.query(
          CREATE_GEOMETRY_FROM_SOURCE_SQL,
          [
            sourceGeometryId,
            JSON.stringify(
              payload.geometry,
            ),
            payload.lineTypeId,
            payload.pointTypeId,
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
        ? one(
          client,
          id,
        )
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
            payload.pointTypeId,
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

    relinkGeometry(
      client,
      geometryId,
    ) {
      return client.query(
        'SELECT relink_city_geometry($1::bigint)',
        [geometryId],
      );
    },

    relinkAllGeometries(
      client,
    ) {
      return client.query(
        'SELECT relink_all_city_geometries()',
      );
    },

    async deleteGeometry(
      client,
      geometryId,
    ) {
      await client.query(
        'DELETE FROM city_geometries WHERE id = $1::bigint',
        [geometryId],
      );
    },

    async previewUnion(
      queryable,
      geometries,
      family,
    ) {
      const result =
        await queryable.query(
          UNION_GEOMETRY_PREVIEW_SQL,
          [
            JSON.stringify(
              geometries,
            ),
            family,
          ],
        );

      return result.rows[0]
        ?.geometry ??
        null;
    },

    async previewCut(    async previewCut(
      queryable,
      sourceGeometry,
      cutterGeometry,
    ) {
      const result =
        await queryable.query(
          CUT_GEOMETRY_PREVIEW_SQL,
          [
            JSON.stringify(
              sourceGeometry,
            ),
            JSON.stringify(
              cutterGeometry,
            ),
          ],
        );

      return result.rows[0]
        ?.geometry ??
        null;
    },

    async previewSplit(
      queryable,
      sourceGeometry,
      blade,
      family,
    ) {
      const result =
        await queryable.query(
          SPLIT_GEOMETRY_PREVIEW_SQL,
          [
            JSON.stringify(
              sourceGeometry,
            ),
            JSON.stringify(
              blade,
            ),
            family,
          ],
        );

      return result.rows.length === 2
        ? result.rows.map(
          (row) =>
            row.geometry,
        )
        : null;
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
        'SELECT relink_all_city_geometries()',
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
