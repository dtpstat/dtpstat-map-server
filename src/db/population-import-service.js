import {
  buildPopulationPlan,
  createPopulationHierarchyAccumulator,
  PopulationValidationError,
} from '../data/population-plan.js';
import { parseStreamingJsonObject } from '../data/streaming-json.js';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

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
    region_name text NOT NULL,
    region_attributes jsonb NOT NULL,
    city_name text NOT NULL,
    population integer,
    as_of text,
    source text,
    attributes jsonb NOT NULL
  ) ON COMMIT DROP
`;

const INSERT_STREAM_STAGE_SQL = `
  INSERT INTO population_transfer_stage (
    seq,
    region_name,
    region_attributes,
    city_name,
    population,
    as_of,
    source,
    attributes
  )
  SELECT
    payload.seq,
    payload."regionName",
    payload."regionAttributes",
    payload."cityName",
    payload.population,
    payload."asOf",
    payload.source,
    payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    seq bigint,
    "regionName" text,
    "regionAttributes" jsonb,
    "cityName" text,
    population integer,
    "asOf" text,
    source text,
    attributes jsonb
  )
`;

const NORMALIZE_NAME_SQL = (expression) => `
  regexp_replace(
    lower(translate(trim(COALESCE(${expression}, '')), 'Ёё', 'Ее')),
    '[^0-9a-zа-я]+',
    '',
    'g'
  )
`;

const RESOLVE_STAGE_SQL = `
  CREATE TEMP TABLE population_transfer_resolved
  ON COMMIT DROP
  AS
  WITH RECURSIVE
  stage_regions AS (
    SELECT DISTINCT
      stage.region_name,
      ${NORMALIZE_NAME_SQL('stage.region_name')} AS region_key
    FROM population_transfer_stage AS stage
  ),
  region_candidates AS (
    SELECT
      stage_region.region_name,
      boundary.id AS region_id
    FROM stage_regions AS stage_region
    JOIN city_boundaries AS boundary
      ON boundary.admin_level = 4
     AND ${NORMALIZE_NAME_SQL('boundary.display_name')} =
         stage_region.region_key
  ),
  region_counts AS (
    SELECT
      stage_region.region_name,
      COUNT(region_candidate.region_id)::integer AS match_count,
      MIN(region_candidate.region_id) AS region_id
    FROM stage_regions AS stage_region
    LEFT JOIN region_candidates AS region_candidate
      ON region_candidate.region_name = stage_region.region_name
    GROUP BY stage_region.region_name
  ),
  descendants AS (
    SELECT
      region_candidate.region_name,
      region_candidate.region_id,
      region_candidate.region_id AS boundary_id
    FROM region_candidates AS region_candidate

    UNION ALL

    SELECT
      parent.region_name,
      parent.region_id,
      child.id
    FROM descendants AS parent
    JOIN city_boundaries AS child
      ON child.parent_id = parent.boundary_id
  ),
  city_candidates AS (
    SELECT
      stage.seq,
      boundary.id AS boundary_id
    FROM population_transfer_stage AS stage
    JOIN region_counts AS region_count
      ON region_count.region_name = stage.region_name
     AND region_count.match_count = 1
    JOIN descendants AS descendant
      ON descendant.region_name = stage.region_name
     AND descendant.region_id = region_count.region_id
    JOIN city_boundaries AS boundary
      ON boundary.id = descendant.boundary_id
     AND boundary.place_type IN ('city', 'town')
     AND ${NORMALIZE_NAME_SQL('boundary.display_name')} =
         ${NORMALIZE_NAME_SQL('stage.city_name')}
  ),
  city_counts AS (
    SELECT
      stage.seq,
      COUNT(candidate.boundary_id)::integer AS match_count,
      MIN(candidate.boundary_id) AS boundary_id
    FROM population_transfer_stage AS stage
    LEFT JOIN city_candidates AS candidate
      ON candidate.seq = stage.seq
    GROUP BY stage.seq
  )
  SELECT
    stage.seq,
    stage.region_name,
    stage.city_name,
    region_count.region_id,
    city_count.boundary_id,
    CASE
      WHEN region_count.match_count = 0 THEN 'region-missing'
      WHEN region_count.match_count > 1 THEN 'region-ambiguous'
      WHEN city_count.match_count = 0 THEN 'city-missing'
      WHEN city_count.match_count > 1 THEN 'city-ambiguous'
      ELSE 'matched'
    END AS status
  FROM population_transfer_stage AS stage
  JOIN region_counts AS region_count
    ON region_count.region_name = stage.region_name
  JOIN city_counts AS city_count
    ON city_count.seq = stage.seq
`;

const RESOLUTION_STATUS_SQL = `
  SELECT
    resolved.seq,
    resolved.region_name AS "regionName",
    resolved.city_name AS "cityName",
    resolved.status
  FROM population_transfer_resolved AS resolved
  ORDER BY resolved.seq
`;

const UPDATE_REGIONS_SQL = `
  UPDATE city_boundaries AS boundary
  SET attributes = source.region_attributes,
      updated_at = now()
  FROM (
    SELECT DISTINCT ON (stage.region_name)
      resolved.region_id,
      stage.region_attributes
    FROM population_transfer_stage AS stage
    JOIN population_transfer_resolved AS resolved
      ON resolved.seq = stage.seq
    WHERE resolved.region_id IS NOT NULL
      AND resolved.status NOT IN ('region-missing', 'region-ambiguous')
    ORDER BY stage.region_name, stage.seq
  ) AS source
  WHERE boundary.id = source.region_id
  RETURNING boundary.id
`;

const UPDATE_CITIES_SQL = `
  UPDATE city_boundaries AS boundary
  SET population = stage.population,
      population_as_of = stage.as_of::date,
      population_source = stage.source,
      attributes = stage.attributes,
      updated_at = now()
  FROM population_transfer_stage AS stage
  JOIN population_transfer_resolved AS resolved
    ON resolved.seq = stage.seq
   AND resolved.status = 'matched'
  WHERE boundary.id = resolved.boundary_id
  RETURNING boundary.id
`;

async function insertStageBatch(client, rows, startSeq = 0) {
  if (rows.length === 0) return 0;
  const payload = rows.map((row, index) => ({
    seq: startSeq + index,
    ...row,
  }));
  const inserted = await client.query(
    INSERT_STREAM_STAGE_SQL,
    [JSON.stringify(payload)],
  );
  if (inserted.rowCount !== payload.length) {
    throw new Error('Not every normalized population city was staged');
  }
  return inserted.rowCount;
}

function resolutionSummary(rows) {
  const skipped = rows
    .filter((row) =>
      row.status === 'region-missing' || row.status === 'city-missing')
    .map((row) => `${row.regionName} / ${row.cityName}`);
  const ambiguous = rows
    .filter((row) =>
      row.status === 'region-ambiguous' || row.status === 'city-ambiguous')
    .map((row) =>
      `${row.regionName} / ${row.cityName} (${row.status})`);
  return { skipped, ambiguous };
}

function assertNoAmbiguity(ambiguous) {
  if (ambiguous.length === 0) return;
  const preview = ambiguous.slice(0, 20).join(', ');
  throw new PopulationValidationError(
    `Population names are ambiguous in the current boundary tree: ${preview}`,
  );
}

async function applyStagedPopulation(client, plan, operation) {
  await client.query(RESOLVE_STAGE_SQL);
  const statusResult = await client.query(RESOLUTION_STATUS_SQL);
  const { skipped, ambiguous } = resolutionSummary(statusResult.rows);
  assertNoAmbiguity(ambiguous);

  const regionsUpdated = await client.query(UPDATE_REGIONS_SQL);
  const citiesUpdated = await client.query(UPDATE_CITIES_SQL);
  const updatedCities = citiesUpdated.rowCount ?? 0;

  if (updatedCities + skipped.length !== plan.cityCount) {
    throw new Error(
      'Population hierarchy import did not account for every city',
    );
  }

  await client.query('SELECT sync_active_boundary_populations()');
  await client.query(RECALCULATE_CITY_STATISTICS_SQL);
  operation.onProgress?.({
    phase: 'database',
    regions: regionsUpdated.rowCount ?? 0,
    cities: updatedCities,
    skippedCities: skipped.length,
  });

  return {
    regions: regionsUpdated.rowCount ?? 0,
    requestedRegions: plan.regionCount,
    cities: updatedCities,
    requestedCities: plan.cityCount,
    skippedCount: skipped.length,
    skippedCities: skipped,
    asOf: plan.asOf,
    source: plan.source,
  };
}

/**
 * Population import is deliberately independent from OSM identity and active
 * state. The portable contract names regions and cities only. A region is
 * resolved by normalized display name among admin-level 4 boundaries; a city
 * is then resolved by normalized display name inside that region subtree.
 *
 * Population metadata is written to the exact matched city boundary. Region
 * attributes are written to the matched region boundary. IS_ACTIVE is never
 * modified here.
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
            throw new Error('Not every population region was staged');
          }
          rawBatch = [];
        };

        const parsed = await parseStreamingJsonObject(source, {
          arrayKey: 'regions',
          metadataKeys: new Set([
            'schemaVersion',
            'exportedAt',
            'asOf',
            'source',
          ]),
          maxBytes: operation.maxJsonBytes,
          maxItemBytes: operation.maxItemBytes,
          maxDepth: operation.maxJsonDepth,
          maxItems: operation.maxJsonItems,
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
              dataSet: 'regions',
            });
          },
        });
        await flushRaw();

        const accumulator = createPopulationHierarchyAccumulator({
          asOf: parsed.metadata.asOf,
          source: parsed.metadata.source,
          maxItems: operation.maxJsonItems,
        });
        await client.query(CREATE_STREAM_STAGE_SQL);

        let lastRegionSeq = -1;
        let citySeq = 0;
        let staged = 0;
        for (;;) {
          throwIfAdminTaskCancelled(operation.signal);
          const regions = await client.query(
            `SELECT seq::bigint::text AS seq, item
             FROM population_transfer_raw
             WHERE seq > $1
             ORDER BY seq
             LIMIT $2`,
            [lastRegionSeq, STREAM_STAGE_BATCH_SIZE],
          );
          if (regions.rowCount === 0) break;

          for (const region of regions.rows) {
            const regionSeq = Number(region.seq);
            const normalized = accumulator.addRegion(
              region.item,
              regionSeq,
            );
            for (
              let offset = 0;
              offset < normalized.rows.length;
              offset += STREAM_STAGE_BATCH_SIZE
            ) {
              const batch = normalized.rows.slice(
                offset,
                offset + STREAM_STAGE_BATCH_SIZE,
              );
              staged += await insertStageBatch(
                client,
                batch,
                citySeq,
              );
              citySeq += batch.length;
            }
            lastRegionSeq = regionSeq;
            operation.onProgress?.({
              phase: 'normalize-stage',
              staged,
              parsedRegions: parsed.itemCount,
              processedRegions: regionSeq + 1,
            });
          }
        }

        const plan = accumulator.finish(parsed.metadata);
        if (plan.cityCount !== staged) {
          throw new Error('Not every normalized population city was staged');
        }

        operation.onProgress?.({
          phase: 'validated',
          regions: plan.regionCount,
          cities: plan.cityCount,
          asOf: plan.asOf,
          source: plan.source,
          decodedBytes: parsed.decodedBytes,
        });

        const result = await applyStagedPopulation(
          client,
          plan,
          operation,
        );
        throwIfAdminTaskCancelled(operation.signal);
        operation.onCommit?.();
        await client.query('COMMIT');

        return {
          ...result,
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
      const plan = buildPopulationPlan(payload, {
        maxItems: operation.maxJsonItems,
      });
      operation.onProgress?.({
        phase: 'validated',
        regions: plan.regionCount,
        cities: plan.cityCount,
        asOf: plan.asOf,
        source: plan.source,
      });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        throwIfAdminTaskCancelled(operation.signal);
        await client.query(CREATE_STREAM_STAGE_SQL);

        let staged = 0;
        for (
          let offset = 0;
          offset < plan.cities.length;
          offset += STREAM_STAGE_BATCH_SIZE
        ) {
          const batch = plan.cities.slice(
            offset,
            offset + STREAM_STAGE_BATCH_SIZE,
          );
          staged += await insertStageBatch(client, batch, offset);
        }
        if (staged !== plan.cityCount) {
          throw new Error('Not every normalized population city was staged');
        }

        const result = await applyStagedPopulation(
          client,
          plan,
          operation,
        );
        throwIfAdminTaskCancelled(operation.signal);
        operation.onCommit?.();
        await client.query('COMMIT');

        return {
          ...result,
          updatedAt: new Date().toISOString(),
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
