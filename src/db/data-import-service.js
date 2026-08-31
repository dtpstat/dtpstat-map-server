import { buildGeoJsonPlan } from '../data/geojson-plan.js';

const UPSERT_CITIES_SQL = `
  INSERT INTO cities (
    slug,
    name,
    full_name,
    population,
    lane_length_m,
    bounds,
    attributes
  )
  SELECT
    payload.slug,
    payload.name,
    payload."fullName",
    payload.population,
    payload."laneLengthMeters",
    ST_MakeBox2D(
      ST_Point(
        (payload.bounds ->> 0)::double precision,
        (payload.bounds ->> 1)::double precision
      ),
      ST_Point(
        (payload.bounds ->> 2)::double precision,
        (payload.bounds ->> 3)::double precision
      )
    ),
    payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    slug text,
    name text,
    "fullName" text,
    population integer,
    "laneLengthMeters" double precision,
    bounds jsonb,
    attributes jsonb
  )
  ON CONFLICT (name) DO UPDATE SET
    slug = EXCLUDED.slug,
    full_name = EXCLUDED.full_name,
    population = EXCLUDED.population,
    lane_length_m = EXCLUDED.lane_length_m,
    bounds = EXCLUDED.bounds,
    attributes = EXCLUDED.attributes,
    updated_at = now()
`;

const INSERT_GEOMETRIES_SQL = `
  INSERT INTO city_geometries (
    city_id,
    lanes,
    length_m,
    lane_length_m,
    properties,
    geom
  )
  SELECT
    cities.id,
    payload.lanes,
    payload."lengthMeters",
    payload."laneLengthMeters",
    payload.properties,
    ST_SetSRID(ST_GeomFromGeoJSON(payload.geometry::text), 4326)
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    "cityName" text,
    lanes smallint,
    "lengthMeters" double precision,
    "laneLengthMeters" double precision,
    properties jsonb,
    geometry jsonb
  )
  JOIN cities ON cities.name = payload."cityName"
`;

const UPDATE_STATISTICS_SQL = `
  WITH statistics AS (
    SELECT
      city_id,
      SUM(lane_length_m)::double precision AS lane_length_m,
      ST_Extent(geom)::box2d AS bounds
    FROM city_geometries
    GROUP BY city_id
  )
  UPDATE cities
  SET
    lane_length_m = statistics.lane_length_m,
    bounds = statistics.bounds,
    updated_at = now()
  FROM statistics
  WHERE cities.id = statistics.city_id
  RETURNING cities.id
`;

/**
 * @typedef {{
 *   query: (text: string, values?: unknown[]) => Promise<{ rows: any[], rowCount?: number }>,
 *   release: () => void
 * }} DatabaseClient
 */

/**
 * Atomically replace all city geometry data from one complete GeoJSON upload.
 *
 * @param {{ connect: () => Promise<DatabaseClient> }} pool
 */
export function createDataImportService(pool) {
  return {
    /** @param {unknown} collection */
    async replaceFromGeoJson(collection) {
      const plan = buildGeoJsonPlan(collection);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('dtpstat-buslines:data-import'))`,
        );

        await client.query('DELETE FROM city_geometries');
        await client.query('DELETE FROM cities WHERE NOT (name = ANY($1::text[]))', [
          plan.cities.map((city) => city.name),
        ]);
        await client.query(UPSERT_CITIES_SQL, [JSON.stringify(plan.cities)]);
        const geometryResult = await client.query(INSERT_GEOMETRIES_SQL, [
          JSON.stringify(plan.geometries),
        ]);
        const statisticsResult = await client.query(UPDATE_STATISTICS_SQL);

        if (geometryResult.rowCount !== plan.geometries.length) {
          throw new Error('Not every GeoJSON geometry was inserted');
        }
        if (statisticsResult.rowCount !== plan.cities.length) {
          throw new Error('Not every city statistic was updated');
        }

        await client.query('COMMIT');
        return {
          cities: plan.cities.length,
          geometries: plan.geometries.length,
          ignoredFeatures: plan.ignoredFeatures.length,
          updatedAt: new Date().toISOString(),
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
