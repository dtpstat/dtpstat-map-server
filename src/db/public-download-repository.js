const EXPORT_PUBLIC_GEOJSON_SQL = `
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(
      json_agg(
        json_build_object(
          'type', 'Feature',
          'id', geometry.id,
          'geometry', ST_AsGeoJSON(geometry.geom)::json,
          'properties', jsonb_strip_nulls(
            jsonb_build_object(
              'short_name', city.name,
              'name', COALESCE(city.full_name, city.name),
              'lanes', geometry.lanes,
              'length', geometry.length_m,
              'lanes_length', geometry.lane_length_m,
              'population', population.population,
              'type', line_type.name
            )
          )
        )
        ORDER BY geometry.id
      ) FILTER (WHERE geometry.id IS NOT NULL),
      '[]'::json
    )
  ) AS payload
  FROM city_geometries AS geometry
  JOIN line_types AS line_type ON line_type.id = geometry.line_type_id
  LEFT JOIN cities AS city ON city.id = geometry.city_id
  LEFT JOIN city_populations AS population ON population.city_id = city.id
`;

const EXPORT_PUBLIC_CSV_SQL = `
  SELECT
    city.name AS short_name,
    city.lane_length_m::double precision AS lanes_length,
    population.population::integer AS population,
    city.lane_m_per_1000::double precision AS lanes_per_1k,
    MIN(ST_XMin(boundary.bounds))::double precision AS minx,
    MIN(ST_YMin(boundary.bounds))::double precision AS miny,
    MAX(ST_XMax(boundary.bounds))::double precision AS maxx,
    MAX(ST_YMax(boundary.bounds))::double precision AS maxy
  FROM cities AS city
  JOIN city_populations AS population ON population.city_id = city.id
  JOIN city_boundaries AS boundary ON boundary.city_id = city.id
  GROUP BY
    city.id,
    city.name,
    city.lane_length_m,
    city.lane_m_per_1000,
    population.population
  ORDER BY city.lane_m_per_1000 DESC NULLS LAST, city.name ASC
`;

/**
 * Public download snapshots intentionally expose only user-facing transport
 * data. Portable/admin exports are separate and may contain synchronization
 * metadata, business dictionaries and style settings.
 *
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }} database
 */
export function createPublicDownloadRepository(database) {
  return {
    async exportGeoJson() {
      const result = await database.query(EXPORT_PUBLIC_GEOJSON_SQL);
      return result.rows[0]?.payload ?? {
        type: 'FeatureCollection',
        features: [],
      };
    },

    async exportCsvRows() {
      const result = await database.query(EXPORT_PUBLIC_CSV_SQL);
      return result.rows;
    },
  };
}
