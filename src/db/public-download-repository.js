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
    city.name,
    CASE WHEN city.is_large IS TRUE THEN 'large' ELSE 'small' END AS category,
    report.rank::integer AS rank,
    COALESCE(report.values, '{}'::jsonb) AS metrics,
    MIN(ST_XMin(boundary.bounds))::double precision AS minx,
    MIN(ST_YMin(boundary.bounds))::double precision AS miny,
    MAX(ST_XMax(boundary.bounds))::double precision AS maxx,
    MAX(ST_YMax(boundary.bounds))::double precision AS maxy
  FROM cities AS city
  JOIN city_boundaries AS boundary ON boundary.city_id = city.id
  LEFT JOIN city_report_values AS report ON report.city_id = city.id
  GROUP BY
    city.id,
    city.name,
    city.is_large,
    report.rank,
    report.values
  ORDER BY city.is_large DESC NULLS LAST, report.rank NULLS LAST, city.name ASC
`;

const EXPORT_PUBLIC_CSV_COLUMNS_SQL = `
  SELECT csv_columns AS "csvColumns"
  FROM report_config
  WHERE id = 1
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

    async exportCsvColumns() {
      const result = await database.query(EXPORT_PUBLIC_CSV_COLUMNS_SQL);
      return result.rows[0]?.csvColumns ?? [];
    },
  };
}
