/**
 * @typedef {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} Queryable
 */

const LIST_CITIES_SQL = `
  SELECT
    id::integer AS id,
    slug,
    name,
    full_name AS "fullName",
    population,
    lane_length_m AS "laneLengthMeters",
    lane_m_per_1000 AS "laneMetersPer1000",
    CASE WHEN is_large THEN 'large' ELSE 'small' END AS category,
    ROW_NUMBER() OVER (
      PARTITION BY is_large
      ORDER BY lane_m_per_1000 DESC, name ASC
    )::integer AS rank,
    json_build_array(
      ST_XMin(bounds),
      ST_YMin(bounds),
      ST_XMax(bounds),
      ST_YMax(bounds)
    ) AS bounds
  FROM cities
  ORDER BY is_large DESC, lane_m_per_1000 DESC, name ASC
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
  WHERE cities.id = $1
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

    /** @param {number} cityId */
    async getCityGeometries(cityId) {
      const result = await database.query(CITY_GEOMETRIES_SQL, [cityId]);
      return result.rows[0]?.geojson ?? null;
    },
  };
}
