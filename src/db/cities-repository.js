/**
 * @typedef {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} Queryable
 */

const LIST_CITIES_SQL = `
  SELECT
    city.id::integer AS id,
    slug,
    name,
    full_name AS "fullName",
    population.population,
    city.lane_length_m AS "laneLengthMeters",
    city.lane_m_per_1000 AS "laneMetersPer1000",
    CASE WHEN city.is_large THEN 'large' ELSE 'small' END AS category,
    ROW_NUMBER() OVER (
      PARTITION BY city.is_large
      ORDER BY city.lane_m_per_1000 DESC, city.name ASC
    )::integer AS rank,
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
  JOIN city_populations AS population ON population.city_id = city.id
  JOIN city_boundaries AS boundary ON boundary.city_id = city.id
  ORDER BY city.is_large DESC, city.lane_m_per_1000 DESC, city.name ASC
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
  LEFT JOIN city_geometries ON city_geometries.city_id = cities.id
  LEFT JOIN line_types AS line_type ON line_type.id = city_geometries.line_type_id
  WHERE cities.id = $1
  GROUP BY cities.id
`;

const VIEWPORT_GEOMETRIES_SQL = `
  WITH viewport AS (
    SELECT
      ST_MakeEnvelope($1, $2, $3, $4, 4326) AS geom,
      ST_SetSRID(ST_MakePoint($5, $6), 4326) AS center
  ),
  visible_geometries AS (
    SELECT
      geometry.id,
      geometry.city_id,
      line_type.code AS business_type_code,
      geometry.lanes,
      geometry.length_m,
      geometry.lane_length_m,
      geometry.properties,
      geometry.geom
    FROM viewport
    JOIN city_geometries AS geometry
      ON geometry.geom && viewport.geom
     AND ST_Intersects(geometry.geom, viewport.geom)
    JOIN line_types AS line_type ON line_type.id = geometry.line_type_id
  ),
  center_city AS (
    SELECT boundary.city_id::integer AS id
    FROM viewport
    JOIN city_boundaries AS boundary
      ON boundary.city_id IS NOT NULL
     AND boundary.geom && viewport.center
     AND ST_Covers(boundary.geom, viewport.center)
    ORDER BY ST_Area(boundary.geom::geography), boundary.city_id
    LIMIT 1
  )
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'bbox', json_build_array($1, $2, $3, $4),
    'centerCityId', (SELECT id FROM center_city),
    'features', COALESCE(
      json_agg(
        json_build_object(
          'type', 'Feature',
          'id', visible_geometries.id,
          'geometry', ST_AsGeoJSON(visible_geometries.geom)::json,
          'properties', visible_geometries.properties || jsonb_build_object(
            'cityId', visible_geometries.city_id,
            'businessTypeCode', visible_geometries.business_type_code,
            'lanes', visible_geometries.lanes,
            'length', visible_geometries.length_m,
            'lanes_length', visible_geometries.lane_length_m
          )
        ) ORDER BY visible_geometries.id
      ) FILTER (
        WHERE visible_geometries.id IS NOT NULL
          AND NOT ST_IsEmpty(visible_geometries.geom)
      ),
      '[]'::json
    )
  ) AS geojson
  FROM visible_geometries
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

    /** @param {number} cityId */
    async getCityGeometries(cityId) {
      const result = await database.query(CITY_GEOMETRIES_SQL, [cityId]);
      return result.rows[0]?.geojson ?? null;
    },

    /**
     * Return complete line geometries that intersect the current viewport.
     * The viewport is only a selector; geometries are never clipped to it.
     *
     * @param {{ west: number, south: number, east: number, north: number, centerLng: number, centerLat: number }} viewport
     */
    async getViewportGeometries(viewport) {
      const result = await database.query(VIEWPORT_GEOMETRIES_SQL, [
        viewport.west,
        viewport.south,
        viewport.east,
        viewport.north,
        viewport.centerLng,
        viewport.centerLat,
      ]);
      return result.rows[0].geojson;
    },
  };
}
