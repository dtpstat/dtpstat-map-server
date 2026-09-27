export const RECALCULATE_CITY_STATISTICS_SQL = `
  WITH geometry_statistics AS (
    SELECT
      city.id AS city_id,
      COALESCE(
        SUM(
          CASE
            WHEN boundary.is_active
              THEN ST_Length(geometry.geom::geography) * geometry.lanes
            ELSE 0
          END
        ),
        0
      )::double precision AS lane_length_m
    FROM cities AS city
    LEFT JOIN city_geometries AS geometry ON geometry.city_id = city.id
    LEFT JOIN city_boundaries AS boundary
      ON boundary.id = geometry.boundary_id
    GROUP BY city.id
  ),
  boundary_statistics AS (
    SELECT
      boundary.city_id,
      MAX(boundary.area_m2)::double precision AS area_m2
    FROM city_boundaries AS boundary
    WHERE boundary.is_active
      AND boundary.city_id IS NOT NULL
    GROUP BY boundary.city_id
  ),
  thresholds AS (
    SELECT
      large_city_population_threshold AS population_threshold,
      large_city_area_km2_threshold AS area_threshold_km2
    FROM project_settings
    WHERE id = 1
  )
  UPDATE cities AS city
  SET
    lane_length_m = statistics.lane_length_m,
    lane_m_per_1000 = CASE
      WHEN population.population IS NULL THEN NULL
      ELSE statistics.lane_length_m / population.population * 1000.0
    END,
    is_large = CASE
      WHEN population.population IS NOT NULL
        THEN population.population >= thresholds.population_threshold
      WHEN boundary_statistics.area_m2 IS NOT NULL
           AND thresholds.area_threshold_km2 IS NOT NULL
        THEN boundary_statistics.area_m2 / 1000000.0 >= thresholds.area_threshold_km2
      ELSE FALSE
    END,
    updated_at = now()
  FROM geometry_statistics AS statistics
  CROSS JOIN thresholds
  LEFT JOIN city_populations AS population
    ON population.city_id = statistics.city_id
  LEFT JOIN boundary_statistics
    ON boundary_statistics.city_id = statistics.city_id
  WHERE city.id = statistics.city_id
  RETURNING city.id
`;
