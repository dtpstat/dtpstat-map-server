export const VIEWPORT_EXPANSION_RATIO = 0.2;

/**
 * Expand a visible WGS84 viewport to 120% of its width and height: the extra
 * 20% is split evenly, so each side receives 10% padding. API validation is
 * performed against the actual visible window; only the DB selector is padded.
 *
 * @param {{ west: number, south: number, east: number, north: number }} viewport
 */
export function expandViewportBounds(
  viewport,
) {
  const width =
    viewport.east -
    viewport.west;
  const height =
    viewport.north -
    viewport.south;
  const horizontalPadding =
    width *
    VIEWPORT_EXPANSION_RATIO /
    2;
  const verticalPadding =
    height *
    VIEWPORT_EXPANSION_RATIO /
    2;

  return {
    west:
      Math.max(
        -180,
        viewport.west -
          horizontalPadding,
      ),
    south:
      Math.max(
        -90,
        viewport.south -
          verticalPadding,
      ),
    east:
      Math.min(
        180,
        viewport.east +
          horizontalPadding,
      ),
    north:
      Math.min(
        90,
        viewport.north +
          verticalPadding,
      ),
  };
}

export const VIEWPORT_GEOMETRIES_SQL = `
  WITH viewport AS (
    SELECT
      ST_MakeEnvelope(
        $1::double precision,
        $2::double precision,
        $3::double precision,
        $4::double precision,
        4326
      ) AS geom,
      ST_SetSRID(
        ST_MakePoint(
          $5::double precision,
          $6::double precision
        ),
        4326
      ) AS center,
      $7::double precision AS zoom
  ),
  visible_geometries AS (
    SELECT
      geometry.id,
      geometry.city_id,
      line_type.code AS business_type_code,
      geometry.point_type_id,
      geometry.display_name,
      geometry.tooltip,
      geometry.lanes,
      geometry.length_m,
      geometry.lane_length_m,
      geometry.min_zoom,
      geometry.max_zoom,
      geometry.valid_from,
      geometry.valid_to,
      geometry.properties,
      geometry.geom
    FROM viewport
    JOIN city_geometries AS geometry
      ON geometry.geom && viewport.geom
     AND ST_Intersects(
       geometry.geom,
       viewport.geom
     )
    JOIN city_boundaries AS active_boundary
      ON active_boundary.id =
         geometry.boundary_id
     AND active_boundary.is_active
    LEFT JOIN line_types AS line_type
      ON line_type.id =
         geometry.line_type_id
    LEFT JOIN point_types AS point_type
      ON point_type.id =
         geometry.point_type_id
    WHERE geometry.is_visible
      AND COALESCE(
        geometry.min_zoom,
        8.0
      ) <= viewport.zoom
      AND (
        geometry.max_zoom IS NULL
        OR viewport.zoom <=
           geometry.max_zoom
      )
      AND (
        line_type.id IS NOT NULL
        OR GeometryType(
          geometry.geom
        ) IN (
          'POLYGON',
          'MULTIPOLYGON'
        )
        OR (
          GeometryType(
            geometry.geom
          ) = 'POINT'
          AND point_type.id IS NOT NULL
          AND point_type.is_active
          AND COALESCE(
            point_type.min_zoom,
            0.0
          ) <= viewport.zoom
          AND (
            point_type.max_zoom IS NULL
            OR viewport.zoom <=
               point_type.max_zoom
          )
        )
      )
  ),
  center_city AS (
    SELECT
      boundary.city_id::integer AS id
    FROM viewport
    JOIN city_boundaries AS boundary
      ON boundary.city_id IS NOT NULL
     AND boundary.is_active
     AND boundary.geom &&
         viewport.center
     AND ST_Covers(
       boundary.geom,
       viewport.center
     )
     AND EXISTS (
       SELECT 1
       FROM city_geometries
         AS geometry_presence
       JOIN city_boundaries
         AS geometry_boundary
         ON geometry_boundary.id =
            geometry_presence
              .boundary_id
        AND geometry_boundary
              .is_active
       WHERE geometry_presence
               .city_id =
             boundary.city_id
     )
    ORDER BY
      boundary.area_m2,
      boundary.city_id
    LIMIT 1
  )
  SELECT json_build_object(
    'type',
    'FeatureCollection',
    'bbox',
    json_build_array(
      $1::double precision,
      $2::double precision,
      $3::double precision,
      $4::double precision
    ),
    'centerCityId',
    (
      SELECT id
      FROM center_city
    ),
    'features',
    COALESCE(
      json_agg(
        json_build_object(
          'type',
          'Feature',
          'id',
          visible_geometries.id,
          'geometry',
          ST_AsGeoJSON(
            visible_geometries.geom
          )::json,
          'properties',
          visible_geometries.properties ||
          jsonb_build_object(
            'cityId',
            visible_geometries.city_id,
            'businessTypeCode',
            visible_geometries
              .business_type_code,
            'pointTypeId',
            visible_geometries
              .point_type_id,
            'displayName',
            visible_geometries
              .display_name,
            'tooltip',
            visible_geometries.tooltip,
            'lanes',
            visible_geometries.lanes,
            'length',
            visible_geometries
              .length_m,
            'lanes_length',
            visible_geometries
              .lane_length_m,
            'minZoom',
            visible_geometries.min_zoom,
            'maxZoom',
            visible_geometries.max_zoom,
            'validFrom',
            visible_geometries
              .valid_from,
            'validTo',
            visible_geometries.valid_to
          )
        )
        ORDER BY
          visible_geometries.id
      ) FILTER (
        WHERE
          visible_geometries.id
            IS NOT NULL
          AND NOT ST_IsEmpty(
            visible_geometries.geom
          )
      ),
      '[]'::json
    )
  ) AS geojson
  FROM visible_geometries
`;

/**
 * @param {{ west: number, south: number, east: number, north: number, centerLng: number, centerLat: number, zoom?: number }} viewport
 */
export function viewportGeometryQuery(
  viewport,
) {
  const selector =
    expandViewportBounds(
      viewport,
    );

  return {
    text:
      VIEWPORT_GEOMETRIES_SQL,
    values: [
      selector.west,
      selector.south,
      selector.east,
      selector.north,
      viewport.centerLng,
      viewport.centerLat,
      Number.isFinite(
        Number(viewport.zoom),
      )
        ? Number(viewport.zoom)
        : 8,
    ],
    selector,
  };
}
