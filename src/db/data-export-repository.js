const EXPORT_CITY_BOUNDARIES_SQL = `
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'name', 'dtpstat-buslines-cities',
    'schemaVersion', 1,
    'exportedAt', now(),
    'features', COALESCE(
      json_agg(
        json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(boundary.geom)::json,
          'properties', jsonb_build_object(
            'placeType', boundary.place_type,
            'osmType', boundary.osm_type,
            'osmId', boundary.osm_id,
            'osmName', boundary.osm_name,
            'tags', boundary.tags,
            'osmTimestamp', boundary.osm_timestamp,
            'updatedAt', boundary.updated_at,
            'citySlug', city.slug,
            'cityName', city.name,
            'city', CASE
              WHEN city.id IS NULL THEN NULL
              ELSE jsonb_build_object(
                'slug', city.slug,
                'name', city.name,
                'fullName', city.full_name,
                'attributes', city.attributes
              )
            END
          )
        )
        ORDER BY boundary.place_type, boundary.osm_name, boundary.osm_type, boundary.osm_id
      ),
      '[]'::json
    )
  )::text AS payload
  FROM city_boundaries AS boundary
  LEFT JOIN cities AS city ON city.id = boundary.city_id
`;

const EXPORT_LINES_SQL = `
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'name', 'dtpstat-buslines-lines',
    'schemaVersion', 1,
    'exportedAt', now(),
    'features', COALESCE(
      json_agg(
        json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(geometry.geom)::json,
          'properties', geometry.properties || jsonb_strip_nulls(
            jsonb_build_object(
              'short_name', city.name,
              'name', COALESCE(city.full_name, city.name),
              'lanes', geometry.lanes,
              'length', geometry.length_m,
              'lanes_length', geometry.lane_length_m,
              '_dtpstat', jsonb_strip_nulls(
                jsonb_build_object(
                  'citySlug', city.slug,
                  'boundaryOsmType', boundary.osm_type,
                  'boundaryOsmId', boundary.osm_id
                )
              )
            )
          )
        )
        ORDER BY geometry.id
      ),
      '[]'::json
    )
  )::text AS payload
  FROM city_geometries AS geometry
  LEFT JOIN cities AS city ON city.id = geometry.city_id
  LEFT JOIN city_boundaries AS boundary ON boundary.id = geometry.boundary_id
`;

const EXPORT_POPULATIONS_SQL = `
  SELECT json_build_object(
    'schemaVersion', 1,
    'exportedAt', now(),
    'populations', COALESCE(
      json_agg(
        json_build_object(
          'name', city.name,
          'citySlug', city.slug,
          'population', population.population,
          'asOf', population.as_of,
          'source', population.source,
          'attributes', population.attributes
        )
        ORDER BY city.name
      ),
      '[]'::json
    )
  )::text AS payload
  FROM city_populations AS population
  JOIN cities AS city ON city.id = population.city_id
`;

/**
 * Read-only portable snapshots used for backup, transfer and synchronization.
 * PostgreSQL returns already serialized JSON text so large polygon snapshots do
 * not need to be parsed and serialized again by Node.js.
 *
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{rows: any[]}> }} database
 */
export function createDataExportRepository(database) {
  async function payload(sql) {
    const result = await database.query(sql);
    return result.rows[0]?.payload;
  }

  return {
    exportCityBoundaries() {
      return payload(EXPORT_CITY_BOUNDARIES_SQL);
    },
    exportLines() {
      return payload(EXPORT_LINES_SQL);
    },
    exportPopulations() {
      return payload(EXPORT_POPULATIONS_SQL);
    },
  };
}
