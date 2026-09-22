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
    osm_type text NOT NULL,
    osm_id bigint NOT NULL,
    parent_osm_type text,
    parent_osm_id bigint,
    name text NOT NULL,
    type text NOT NULL,
    place_type text,
    admin_level smallint,
    population integer,
    as_of text,
    source text,
    attributes jsonb NOT NULL
  ) ON COMMIT DROP
`;

const INSERT_STREAM_STAGE_SQL = `
  INSERT INTO population_transfer_stage (
    seq,
    osm_type,
    osm_id,
    parent_osm_type,
    parent_osm_id,
    name,
    type,
    place_type,
    admin_level,
    population,
    as_of,
    source,
    attributes
  )
  SELECT
    payload.seq,
    payload."osmType",
    payload."osmId"::bigint,
    payload."parentOsmType",
    NULLIF(payload."parentOsmId", '')::bigint,
    payload.name,
    payload.type,
    payload."placeType",
    payload."adminLevel",
    payload.population,
    payload."asOf",
    payload.source,
    payload.attributes
  FROM jsonb_to_recordset($1::jsonb) AS payload(
    seq bigint,
    "osmType" text,
    "osmId" text,
    "parentOsmType" text,
    "parentOsmId" text,
    name text,
    type text,
    "placeType" text,
    "adminLevel" smallint,
    population integer,
    "asOf" text,
    source text,
    attributes jsonb
  )
`;

const TRANSFER_STATUS_SQL = `
  SELECT
    stage.seq,
    stage.osm_type AS "osmType",
    stage.osm_id::text AS "osmId",
    stage.name,
    CASE
      WHEN boundary.id IS NULL THEN 'missing'
      WHEN stage.parent_osm_id IS NULL AND boundary.parent_id IS NOT NULL
        THEN 'hierarchy'
      WHEN stage.parent_osm_id IS NOT NULL
       AND expected_parent.id IS NOT NULL
       AND boundary.parent_id IS DISTINCT FROM expected_parent.id
        THEN 'hierarchy'
      ELSE 'matched'
    END AS status
  FROM population_transfer_stage AS stage
  LEFT JOIN city_boundaries AS boundary
    ON boundary.osm_type = stage.osm_type
   AND boundary.osm_id = stage.osm_id
  LEFT JOIN city_boundaries AS expected_parent
    ON expected_parent.osm_type = stage.parent_osm_type
   AND expected_parent.osm_id = stage.parent_osm_id
  ORDER BY stage.seq
`;

const UPDATE_TERRITORY_DATA_SQL = `
  UPDATE city_boundaries AS boundary
  SET population = stage.population,
      population_as_of = stage.as_of::date,
      population_source = stage.source,
      attributes = stage.attributes,
      updated_at = now()
  FROM population_transfer_stage AS stage
  WHERE boundary.osm_type = stage.osm_type
    AND boundary.osm_id = stage.osm_id
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
    throw new Error('Not every normalized territory record was staged');
  }
  return inserted.rowCount;
}

function transferStatus(rows) {
  const skipped = rows
    .filter((row) => row.status === 'missing')
    .map((row) => `${row.osmType}/${row.osmId} ${row.name}`);
  const hierarchy = rows
    .filter((row) => row.status === 'hierarchy')
    .map((row) => `${row.osmType}/${row.osmId} ${row.name}`);
  return { skipped, hierarchy };
}

function assertHierarchyMatches(hierarchy) {
  if (hierarchy.length === 0) return;
  const preview = hierarchy.slice(0, 20).join(', ');
  throw new PopulationValidationError(
    `Population hierarchy does not match the current OSM boundary tree: ${preview}`,
  );
}

async function applyStagedTerritories(client, plan, operation) {
  const statusResult = await client.query(TRANSFER_STATUS_SQL);
  const { skipped, hierarchy } = transferStatus(statusResult.rows);
  assertHierarchyMatches(hierarchy);

  const updated = await client.query(UPDATE_TERRITORY_DATA_SQL);
  const updatedTerritories = updated.rowCount ?? 0;
  if (updatedTerritories + skipped.length !== plan.territoryCount) {
    throw new Error(
      'Population hierarchy import did not account for every territory',
    );
  }

  await client.query('SELECT sync_active_boundary_populations()');
  await client.query(RECALCULATE_CITY_STATISTICS_SQL);
  operation.onProgress?.({
    phase: 'database',
    territories: updatedTerritories,
    skippedTerritories: skipped.length,
  });

  return {
    territories: updatedTerritories,
    requestedTerritories: plan.territoryCount,
    roots: plan.rootCount,
    skippedCount: skipped.length,
    skippedTerritories: skipped,
    asOf: plan.asOf,
    source: plan.source,
  };
}

/**
 * Population/attributes belong to exact OSM territories, not to active state.
 * Import identity is (osm_type, osm_id); display names and hierarchy remain
 * human-readable validation context only. Active boundaries are projected into
 * CITY_POPULATIONS after the territory data transaction is staged.
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
            throw new Error('Not every population hierarchy root was staged');
          }
          rawBatch = [];
        };

        const parsed = await parseStreamingJsonObject(source, {
          arrayKey: 'territories',
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
              dataSet: 'territories',
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

        let lastRootSeq = -1;
        let territorySeq = 0;
        let staged = 0;
        for (;;) {
          throwIfAdminTaskCancelled(operation.signal);
          const roots = await client.query(
            `SELECT seq::bigint::text AS seq, item
             FROM population_transfer_raw
             WHERE seq > $1
             ORDER BY seq
             LIMIT $2`,
            [lastRootSeq, STREAM_STAGE_BATCH_SIZE],
          );
          if (roots.rowCount === 0) break;

          for (const root of roots.rows) {
            const rootSeq = Number(root.seq);
            const rows = accumulator.addRoot(root.item, rootSeq);
            for (
              let offset = 0;
              offset < rows.length;
              offset += STREAM_STAGE_BATCH_SIZE
            ) {
              const batch = rows.slice(
                offset,
                offset + STREAM_STAGE_BATCH_SIZE,
              );
              staged += await insertStageBatch(
                client,
                batch,
                territorySeq,
              );
              territorySeq += batch.length;
            }
            lastRootSeq = rootSeq;
            operation.onProgress?.({
              phase: 'normalize-stage',
              staged,
              parsedRoots: parsed.itemCount,
              processedRoots: rootSeq + 1,
            });
          }
        }

        const plan = accumulator.finish(parsed.metadata);
        if (plan.territoryCount !== staged) {
          throw new Error('Not every normalized territory record was staged');
        }

        operation.onProgress?.({
          phase: 'validated',
          territories: plan.territoryCount,
          roots: plan.rootCount,
          asOf: plan.asOf,
          source: plan.source,
          decodedBytes: parsed.decodedBytes,
        });

        const result = await applyStagedTerritories(
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
        territories: plan.territoryCount,
        roots: plan.rootCount,
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
          offset < plan.territories.length;
          offset += STREAM_STAGE_BATCH_SIZE
        ) {
          const batch = plan.territories.slice(
            offset,
            offset + STREAM_STAGE_BATCH_SIZE,
          );
          staged += await insertStageBatch(client, batch, offset);
        }
        if (staged !== plan.territoryCount) {
          throw new Error('Not every normalized territory record was staged');
        }

        const result = await applyStagedTerritories(
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
