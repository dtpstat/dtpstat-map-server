import { buildPopulationPlan } from '../data/population-plan.js';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

const MATCH_STATUS_SQL = `
  WITH payload AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS item(
      name text,
      type text
    )
  )
  SELECT
    payload.name,
    payload.type,
    COUNT(boundary.id)::integer AS match_count
  FROM payload
  LEFT JOIN city_boundaries AS boundary
    ON boundary.is_active
   AND LOWER(REGEXP_REPLACE(boundary.display_name, '[[:space:]]+', '', 'g'))
       = LOWER(REGEXP_REPLACE(payload.name, '[[:space:]]+', '', 'g'))
   AND (
     payload.type IS NULL
     OR LOWER(REGEXP_REPLACE(boundary.display_type, '[[:space:]]+', '', 'g'))
        = LOWER(REGEXP_REPLACE(payload.type, '[[:space:]]+', '', 'g'))
   )
  GROUP BY payload.name, payload.type
  HAVING COUNT(boundary.id) <> 1
  ORDER BY payload.name, payload.type NULLS FIRST
`;

const UPSERT_POPULATIONS_SQL = `
  WITH payload AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS item(
      name text,
      type text,
      population integer,
      "asOf" text,
      source text,
      attributes jsonb
    )
  ),
  resolved AS (
    SELECT
      payload.*,
      match.city_id
    FROM payload
    CROSS JOIN LATERAL (
      SELECT
        MIN(city.id) AS city_id,
        COUNT(*)::integer AS match_count
      FROM city_boundaries AS boundary
      JOIN cities AS city ON city.id = boundary.city_id
      WHERE boundary.is_active
        AND LOWER(REGEXP_REPLACE(boundary.display_name, '[[:space:]]+', '', 'g'))
            = LOWER(REGEXP_REPLACE(payload.name, '[[:space:]]+', '', 'g'))
        AND (
          payload.type IS NULL
          OR LOWER(REGEXP_REPLACE(boundary.display_type, '[[:space:]]+', '', 'g'))
             = LOWER(REGEXP_REPLACE(payload.type, '[[:space:]]+', '', 'g'))
        )
    ) AS match
    WHERE match.match_count = 1
  )
  INSERT INTO city_populations (
    city_id,
    population,
    as_of,
    source,
    attributes
  )
  SELECT
    resolved.city_id,
    resolved.population,
    resolved."asOf"::date,
    resolved.source,
    resolved.attributes
  FROM resolved
  ON CONFLICT (city_id) DO UPDATE SET
    population = EXCLUDED.population,
    as_of = EXCLUDED.as_of,
    source = EXCLUDED.source,
    attributes = EXCLUDED.attributes,
    updated_at = now()
`;

/**
 * Population identity follows active OSM boundary configuration. Matching
 * removes whitespace and ignores case. Legacy records without type are accepted
 * only when their normalized name resolves to exactly one active boundary.
 *
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 */
export function createPopulationImportService(pool) {
  return {
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
        const statusResult = await client.query(MATCH_STATUS_SQL, [serialized]);
        const skippedCities = statusResult.rows
          .filter((row) => row.match_count === 0)
          .map((row) => row.name);
        const ambiguousCities = statusResult.rows
          .filter((row) => row.match_count > 1)
          .map((row) => row.type ? `${row.type} / ${row.name}` : row.name);

        const populationResult = await client.query(UPSERT_POPULATIONS_SQL, [
          serialized,
        ]);
        const updatedCities = populationResult.rowCount ?? 0;
        if (
          updatedCities + skippedCities.length + ambiguousCities.length
          !== plan.populations.length
        ) {
          throw new Error('Population import did not account for every record');
        }

        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        operation.onProgress?.({
          phase: 'database',
          cities: updatedCities,
          skippedCities: skippedCities.length,
          ambiguousCities: ambiguousCities.length,
        });
        throwIfAdminTaskCancelled(operation.signal);
        operation.onCommit?.();
        await client.query('COMMIT');
        return {
          cities: updatedCities,
          requestedCities: plan.populations.length,
          skippedCount: skippedCities.length,
          skippedCities,
          ambiguousCount: ambiguousCities.length,
          ambiguousCities,
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
