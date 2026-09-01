import { buildGeoJsonPlan } from '../data/geojson-plan.js';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

const UPSERT_CITIES_SQL = `
  INSERT INTO cities (
    slug,
    name,
    full_name,
    lane_length_m,
    attributes
  )
  SELECT
    payload.slug,
    payload.name,
    payload."fullName",
    0,
    payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    slug text,
    name text,
    "fullName" text,
    attributes jsonb
  )
  ON CONFLICT (name) DO UPDATE SET
    slug = EXCLUDED.slug,
    full_name = EXCLUDED.full_name,
    attributes = EXCLUDED.attributes,
    updated_at = now()
`;

const INSERT_GEOMETRIES_SQL = `
  WITH payload_rows AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS payload(
      "cityName" text,
      lanes smallint,
      properties jsonb,
      geometry jsonb
    )
  ),
  prepared AS (
    SELECT
      payload_rows.*,
      ST_SetSRID(
        ST_GeomFromGeoJSON(payload_rows.geometry::text),
        4326
      ) AS geom
    FROM payload_rows
  )
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
    prepared.lanes,
    ST_Length(prepared.geom::geography),
    ST_Length(prepared.geom::geography) * prepared.lanes,
    prepared.properties,
    prepared.geom
  FROM prepared
  JOIN cities ON cities.name = prepared."cityName"
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
    /**
     * @param {unknown} collection
     * @param {{ signal?: AbortSignal, onProgress?: (progress: object) => void, onCommit?: () => void }} operation
     */
    async replaceFromGeoJson(collection, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const plan = buildGeoJsonPlan(collection);
      operation.onProgress?.({
        phase: 'validated',
        cities: plan.cities.length,
        geometries: plan.geometries.length,
        ignoredFeatures: plan.ignoredFeatures.length,
      });
      throwIfAdminTaskCancelled(operation.signal);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('dtpstat-buslines:data-import'))`,
        );
        throwIfAdminTaskCancelled(operation.signal);

        await client.query('DELETE FROM city_geometries');
        await client.query(UPSERT_CITIES_SQL, [JSON.stringify(plan.cities)]);
        const geometryResult = await client.query(INSERT_GEOMETRIES_SQL, [
          JSON.stringify(plan.geometries),
        ]);
        const statisticsResult = await client.query(
          RECALCULATE_CITY_STATISTICS_SQL,
        );

        if (geometryResult.rowCount !== plan.geometries.length) {
          throw new Error('Not every GeoJSON geometry was inserted');
        }
        if (statisticsResult.rowCount < plan.cities.length) {
          throw new Error('Not every city statistic was updated');
        }
        operation.onProgress?.({
          phase: 'database',
          cities: plan.cities.length,
          geometries: plan.geometries.length,
        });
        throwIfAdminTaskCancelled(operation.signal);

        operation.onCommit?.();
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
