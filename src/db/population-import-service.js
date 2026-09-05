import {
  buildPopulationPlan,
  PopulationValidationError,
} from '../data/population-plan.js';
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
 * Update one or more population records and then recalculate all city ratings.
 * Top-level asOf/source remain supported as defaults; portable exports may
 * preserve different values per city.
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
        if (unknownResult.rows.length > 0) {
          const names = unknownResult.rows.map((row) => row.name).join(', ');
          throw new PopulationValidationError(`Unknown cities: ${names}`);
        }

        const populationResult = await client.query(UPSERT_POPULATIONS_SQL, [
          serialized,
        ]);
        if (populationResult.rowCount !== plan.populations.length) {
          throw new Error('Not every population record was updated');
        }

        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        operation.onProgress?.({
          phase: 'database',
          cities: plan.populations.length,
        });
        throwIfAdminTaskCancelled(operation.signal);
        operation.onCommit?.();
        await client.query('COMMIT');
        return {
          cities: plan.populations.length,
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
