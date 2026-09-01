export const RECALCULATE_CITY_STATISTICS_SQL = `
  WITH geometry_statistics AS (
    SELECT
      city.id AS city_id,
      COALESCE(
        SUM(ST_Length(geometry.geom::geography) * geometry.lanes),
        0
      )::double precision AS lane_length_m
    FROM cities AS city
    LEFT JOIN city_geometries AS geometry ON geometry.city_id = city.id
    GROUP BY city.id
  )
  UPDATE cities AS city
  SET
    lane_length_m = statistics.lane_length_m,
    lane_m_per_1000 = CASE
      WHEN population.population IS NULL THEN NULL
      ELSE statistics.lane_length_m / population.population * 1000.0
    END,
    is_large = CASE
      WHEN population.population IS NULL THEN NULL
      ELSE population.population > 400000
    END,
    updated_at = now()
  FROM geometry_statistics AS statistics
  LEFT JOIN city_populations AS population
    ON population.city_id = statistics.city_id
  WHERE city.id = statistics.city_id
  RETURNING city.id
`;
