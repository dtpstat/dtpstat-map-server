import {
  viewportGeometryQuery,
} from './viewport-query.js';

export {
  expandViewportBounds,
  VIEWPORT_EXPANSION_RATIO,
} from './viewport-query.js';

/**
 * @typedef {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} Queryable
 */

const LIST_CITIES_SQL = `
  SELECT
    city.id::integer AS id,
    city.slug,
    city.name,
    city.full_name AS "fullName",
    population.population,
    city.lane_length_m AS "laneLengthMeters",
    city.lane_m_per_1000 AS "laneMetersPer1000",
    CASE WHEN city.is_large IS TRUE THEN 'large' ELSE 'small' END AS category,
    report.rank::integer AS rank,
    report.rank_value AS "rankValue",
    COALESCE(report.values, '{}'::jsonb) AS metrics,
    json_build_array(
      ST_XMin(boundary.bounds),
      ST_YMin(boundary.bounds),
      ST_XMax(boundary.bounds),
      ST_YMax(boundary.bounds)
    ) AS bounds,
    json_build_array(
      ST_X(ST_PointOnSurface(boundary.geom)),
      ST_Y(ST_PointOnSurface(boundary.geom))
    ) AS center
  FROM cities AS city
  LEFT JOIN city_populations AS population ON population.city_id = city.id
  JOIN city_boundaries AS boundary
    ON boundary.city_id = city.id
   AND boundary.is_active
  LEFT JOIN city_report_values AS report ON report.city_id = city.id
  WHERE EXISTS (
    SELECT 1
    FROM city_geometries AS geometry_presence
    JOIN city_boundaries AS geometry_boundary
      ON geometry_boundary.id = geometry_presence.boundary_id
     AND geometry_boundary.is_active
    WHERE geometry_presence.city_id = city.id
  )
  ORDER BY city.is_large DESC NULLS LAST, report.rank NULLS LAST, city.name ASC
`;

const GEOMETRY_TIMELINE_BOUNDS_SQL = `
  SELECT
    MIN(
      COALESCE(
        geometry.valid_from,
        geometry.valid_to
      )
    )::text AS "minDate",
    MAX(
      COALESCE(
        geometry.valid_to,
        geometry.valid_from
      )
    )::text AS "maxDate"
  FROM city_geometries AS geometry
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
    AND (
      geometry.valid_from IS NOT NULL
      OR geometry.valid_to IS NOT NULL
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
      )
    )
`;

const CITY_GEOMETRIES_SQL = `
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(
      json_agg(
        json_build_object(
          'type', 'Feature',
          'id', city_geometries.id,
          'geometry', ST_AsGeoJSON(city_geometries.geom)::json,
          'properties', city_geometries.properties || jsonb_build_object(
            'businessTypeCode', line_type.code,
            'pointTypeId', city_geometries.point_type_id,
            'lanes', city_geometries.lanes,
            'length', city_geometries.length_m,
            'lanes_length', city_geometries.lane_length_m
          )
        ) ORDER BY city_geometries.id
      ) FILTER (WHERE city_geometries.id IS NOT NULL),
      '[]'::json
    )
  ) AS geojson
  FROM cities
  LEFT JOIN city_geometries
    ON city_geometries.city_id = cities.id
   AND city_geometries.is_visible
   AND EXISTS (
     SELECT 1
     FROM city_boundaries AS active_boundary
     WHERE active_boundary.id = city_geometries.boundary_id
       AND active_boundary.is_active
   )
  LEFT JOIN line_types AS line_type
    ON line_type.id = city_geometries.line_type_id
  LEFT JOIN point_types AS point_type
    ON point_type.id = city_geometries.point_type_id
  WHERE cities.id = $1::bigint
    AND (
      city_geometries.id IS NULL
      OR GeometryType(city_geometries.geom) <> 'POINT'
      OR point_type.is_active
    )
  GROUP BY cities.id
`;


/**
 * PostgreSQL-backed data access used by the HTTP API.
 *
 * @param {Queryable} database
 */
export function createCitiesRepository(database) {
  return {
    async health() {
      await database.query('SELECT 1');
    },

    async listCities() {
      const result = await database.query(LIST_CITIES_SQL);
      return result.rows;
    },

    async getGeometryTimelineBounds() {
      const result =
        await database.query(
          GEOMETRY_TIMELINE_BOUNDS_SQL,
        );
      return {
        minDate:
          result.rows[0]?.minDate ??
          null,
        maxDate:
          result.rows[0]?.maxDate ??
          null,
      };
    },

    /** @param {number} cityId */
    async getCityGeometries(cityId) {
      const result = await database.query(CITY_GEOMETRIES_SQL, [cityId]);
      return result.rows[0]?.geojson ?? null;
    },

    /**
     * Return public line and typed Point geometries intersecting a selector
     * 20% larger than the visible viewport. The original center remains the
     * city-selection point; geometries are never clipped.
     *
     * @param {{ west: number, south: number, east: number, north: number, centerLng: number, centerLat: number, zoom?: number }} viewport
     */
    async getViewportGeometries(viewport) {
      const query =
        viewportGeometryQuery(
          viewport,
        );
      const result =
        await database.query(
          query.text,
          query.values,
        );
      return result.rows[0].geojson;
    },
  };
}
