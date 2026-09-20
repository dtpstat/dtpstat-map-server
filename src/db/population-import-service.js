import {
  buildPopulationPlan,
  createPopulationAccumulator,
} from '../data/population-plan.js';
import { parseStreamingJsonObject } from '../data/streaming-json.js';
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

const STREAM_STAGE_BATCH_SIZE = 100;

const CREATE_STREAM_RAW_SQL = `
  CREATE TEMP TABLE population_transfer_raw (
    seq bigint PRIMARY KEY,
    item jsonb NOT NULL
  ) ON COMMIT DROP
`;

const INSERT_STREAM_RAW_SQL = `
  INSERT INTO population_transfer_raw (seq, item)
  SELECT payload.seq, payload.item
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    seq bigint,
    item jsonb
  )
`;

const CREATE_STREAM_STAGE_SQL = `
  CREATE TEMP TABLE population_transfer_stage (
    seq bigint PRIMARY KEY,
    name text NOT NULL,
    type text,
    population integer NOT NULL,
    as_of text,
    source text,
    attributes jsonb NOT NULL
  ) ON COMMIT DROP
`;

const INSERT_STREAM_STAGE_SQL = `
  INSERT INTO population_transfer_stage (
    seq,
    name,
    type,
    population,
    as_of,
    source,
    attributes
  )
  SELECT
    payload.seq,
    payload.name,
    payload.type,
    payload.population,
    payload."asOf",
    payload.source,
    payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    seq bigint,
    name text,
    type text,
    population integer,
    "asOf" text,
    source text,
    attributes jsonb
  )
`;

const MATCH_STREAM_STATUS_SQL = `
  SELECT
    stage.name,
    stage.type,
    COUNT(boundary.id)::integer AS match_count
  FROM population_transfer_stage AS stage
  LEFT JOIN city_boundaries AS boundary
    ON boundary.is_active
   AND LOWER(REGEXP_REPLACE(boundary.display_name, '[[:space:]]+', '', 'g'))
       = LOWER(REGEXP_REPLACE(stage.name, '[[:space:]]+', '', 'g'))
   AND (
     stage.type IS NULL
     OR LOWER(REGEXP_REPLACE(boundary.display_type, '[[:space:]]+', '', 'g'))
        = LOWER(REGEXP_REPLACE(stage.type, '[[:space:]]+', '', 'g'))
   )
  GROUP BY stage.seq, stage.name, stage.type
  HAVING COUNT(boundary.id) <> 1
  ORDER BY stage.seq
`;

const UPSERT_STREAM_POPULATIONS_SQL = `
  WITH resolved AS (
    SELECT
      stage.*,
      match.city_id
    FROM population_transfer_stage AS stage
    CROSS JOIN LATERAL (
      SELECT
        MIN(city.id) AS city_id,
        COUNT(*)::integer AS match_count
      FROM city_boundaries AS boundary
      JOIN cities AS city ON city.id = boundary.city_id
      WHERE boundary.is_active
        AND LOWER(REGEXP_REPLACE(boundary.display_name, '[[:space:]]+', '', 'g'))
            = LOWER(REGEXP_REPLACE(stage.name, '[[:space:]]+', '', 'g'))
        AND (
          stage.type IS NULL
          OR LOWER(REGEXP_REPLACE(boundary.display_type, '[[:space:]]+', '', 'g'))
             = LOWER(REGEXP_REPLACE(stage.type, '[[:space:]]+', '', 'g'))
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
    resolved.as_of::date,
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
    async updateFromJsonStream(source, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        throwIfAdminTaskCancelled(operation.signal);
        await client.query(CREATE_STREAM_RAW_SQL);

        let rawBatch = [];
        const flushRaw = async () => {
          if (rawBatch.length === 0) return;
          const inserted = await client.query(
            INSERT_STREAM_RAW_SQL,
            [JSON.stringify(rawBatch)],
          );
          if (inserted.rowCount !== rawBatch.length) {
            throw new Error('Not every population record was staged');
          }
          rawBatch = [];
        };

        const parsed = await parseStreamingJsonObject(source, {
          arrayKey: 'populations',
          metadataKeys: new Set([
            'schemaVersion',
            'exportedAt',
            'asOf',
            'source',
          ]),
          maxBytes: operation.maxJsonBytes,
          maxItemBytes: operation.maxItemBytes,
          signal: operation.signal,
          async onItem(item, index) {
            throwIfAdminTaskCancelled(operation.signal);
            rawBatch.push({ seq: index, item });
            if (rawBatch.length >= STREAM_STAGE_BATCH_SIZE) {
              await flushRaw();
            }
          },
          onProgress(progress) {
            operation.onProgress?.({
              ...progress,
              dataSet: 'populations',
            });
          },
        });
        await flushRaw();

        const accumulator = createPopulationAccumulator({
          asOf: parsed.metadata.asOf,
          source: parsed.metadata.source,
        });
        await client.query(CREATE_STREAM_STAGE_SQL);

        let lastSeq = -1;
        let staged = 0;
        for (;;) {
          throwIfAdminTaskCancelled(operation.signal);
          const rows = await client.query(
            `SELECT seq::bigint::text AS seq, item
             FROM population_transfer_raw
             WHERE seq > $1
             ORDER BY seq
             LIMIT $2`,
            [lastSeq, STREAM_STAGE_BATCH_SIZE],
          );
          if (rows.rowCount === 0) break;

          const normalized = [];
          for (const row of rows.rows) {
            const seq = Number(row.seq);
            normalized.push({
              seq,
              ...accumulator.addItem(row.item, seq),
            });
            lastSeq = seq;
          }
          const inserted = await client.query(
            INSERT_STREAM_STAGE_SQL,
            [JSON.stringify(normalized)],
          );
          if (inserted.rowCount !== normalized.length) {
            throw new Error('Not every normalized population record was staged');
          }
          staged += inserted.rowCount;
          operation.onProgress?.({
            phase: 'normalize-stage',
            staged,
            parsedRecords: parsed.itemCount,
          });
        }

        const plan = accumulator.finish();
        if (plan.populationCount !== staged) {
          throw new Error('Not every normalized population record was staged');
        }
        operation.onProgress?.({
          phase: 'validated',
          cities: plan.populationCount,
          asOf: plan.asOf,
          source: plan.source,
          decodedBytes: parsed.decodedBytes,
        });

        const statusResult = await client.query(MATCH_STREAM_STATUS_SQL);
        const skippedCities = statusResult.rows
          .filter((row) => row.match_count === 0)
          .map((row) => row.name);
        const ambiguousCities = statusResult.rows
          .filter((row) => row.match_count > 1)
          .map((row) => row.type ? `${row.type} / ${row.name}` : row.name);

        const populationResult = await client.query(
          UPSERT_STREAM_POPULATIONS_SQL,
        );
        const updatedCities = populationResult.rowCount ?? 0;
        if (
          updatedCities +
            skippedCities.length +
            ambiguousCities.length !==
          plan.populationCount
        ) {
          throw new Error(
            'Population import did not account for every record',
          );
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
          requestedCities: plan.populationCount,
          skippedCount: skippedCities.length,
          skippedCities,
          ambiguousCount: ambiguousCities.length,
          ambiguousCities,
          asOf: plan.asOf,
          source: plan.source,
          decodedBytes: parsed.decodedBytes,
          streamed: true,
          updatedAt: new Date().toISOString(),
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

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
