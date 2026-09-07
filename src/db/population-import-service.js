import { buildPopulationPlan } from '../data/population-plan.js';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

const FIND_UNKNOWN_CITIES_SQL = `
  SELECT payload.name
  FROM jsonb_to_recordset($1::jsonb) AS payload(name text)
  LEFT JOIN cities ON cities.name = payload.name
  WHERE cities.id IS NULL
  ORDER BY payload.name
`;

const UPSERT_POPULATIONS_SQL = `
  INSERT INTO city_populations (
    city_id,
    population,
    as_of,
    source,
    attributes
  )
  SELECT
    cities.id,
    payload.population,
    payload."asOf"::date,
    payload.source,
    payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    name text,
    population integer,
    "asOf" text,
    source text,
    attributes jsonb
  )
  JOIN cities ON cities.name = payload.name
  ON CONFLICT (city_id) DO UPDATE SET
    population = EXCLUDED.population,
    as_of = EXCLUDED.as_of,
    source = EXCLUDED.source,
    attributes = EXCLUDED.attributes,
    updated_at = now()
`;

/**
 * Update population records only for cities that currently exist in the
 * database, then recalculate all city ratings. Population entries for cities
 * absent from the database are reported as skipped rather than aborting the
 * whole import. Top-level asOf/source remain supported as defaults; portable
 * exports may preserve different values per city.
 *
 * @param {{ connect: () => Promise<import('./data-import-service.js').DatabaseClient>, databaseSchema?: string }} pool
 */
export function createPopulationImportService(pool) {
  return {
    /**
     * @param {unknown} payload
     * @param {{ signal?: AbortSignal, onProgress?: (progress: object) => void, onCommit?: () => void }} operation
     */
    async updateFromJson(payload, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const plan = buildPopulationPlan(payload);
      operation.onProgress?.({
        phase: 'validated',
        cities: plan.populations.length,
        asOf: plan.asOf,
        source: plan.source,
      });
      throwIfAdminTaskCancelled(operation.signal);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        throwIfAdminTaskCancelled(operation.signal);

        const serialized = JSON.stringify(plan.populations);
        const unknownResult = await client.query(FIND_UNKNOWN_CITIES_SQL, [
          serialized,
        ]);
        const skippedCities = unknownResult.rows.map((row) => row.name);

        const populationResult = await client.query(UPSERT_POPULATIONS_SQL, [
          serialized,
        ]);
        const updatedCities = populationResult.rowCount ?? 0;
        if (updatedCities + skippedCities.length !== plan.populations.length) {
          throw new Error('Population import did not account for every record');
        }

        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        operation.onProgress?.({
          phase: 'database',
          cities: updatedCities,
          skippedCities: skippedCities.length,
        });
        throwIfAdminTaskCancelled(operation.signal);
        operation.onCommit?.();
        await client.query('COMMIT');
        return {
          cities: updatedCities,
          requestedCities: plan.populations.length,
          skippedCount: skippedCities.length,
          skippedCities,
          asOf: plan.asOf,
          source: plan.source,
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
