import {
  buildPopulationPlan,
  PopulationValidationError,
} from '../data/population-plan.js';
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
    $2::date,
    $3::text,
    payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    name text,
    population integer,
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
 *
 * @param {{ connect: () => Promise<import('./data-import-service.js').DatabaseClient> }} pool
 */
export function createPopulationImportService(pool) {
  return {
    /** @param {unknown} payload */
    async updateFromJson(payload) {
      const plan = buildPopulationPlan(payload);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('dtpstat-buslines:data-import'))`,
        );

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
          plan.asOf,
          plan.source,
        ]);
        if (populationResult.rowCount !== plan.populations.length) {
          throw new Error('Not every population record was updated');
        }

        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
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
