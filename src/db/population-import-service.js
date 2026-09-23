import {
  buildPopulationPlan,
  createPopulationHierarchyAccumulator,
} from '../data/population-plan.js';
import { parseStreamingJsonObject } from '../data/streaming-json.js';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import {
  createPopulationImportRepository,
} from '../modules/population/import-repository.js';
import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

const STREAM_STAGE_BATCH_SIZE = 100;
const WARNING_LOG_PREVIEW = 100;

function resolutionWarning(row) {
  const reason = {
    'region-missing': 'region not found',
    'region-ambiguous': 'region name is ambiguous',
    'city-missing': 'city not found inside region',
    'city-ambiguous': 'city name is ambiguous inside region',
    'city-duplicate-target': 'city resolves to a boundary already targeted by another entry',
  }[row.status] ?? row.status;

  return {
    code: row.status,
    scope: 'city',
    regionName: row.regionName,
    cityName: row.cityName,
    skipped: true,
    message: `${row.regionName} / ${row.cityName}: ${reason}`,
  };
}

function resolutionWarnings(rows) {
  return rows
    .filter((row) => row.status !== 'matched')
    .map(resolutionWarning);
}

function skippedCityLabels(warnings) {
  return warnings
    .filter((item) => item.scope === 'city' && item.skipped)
    .map((item) => [
      item.regionName,
      item.cityName,
    ].filter(Boolean).join(' / ') || item.message);
}

function reportWarnings(operation, warnings, skippedCount) {
  if (warnings.length === 0) return;
  operation.onProgress?.({
    phase: 'warnings',
    warningCount: warnings.length,
    skippedCount,
    warnings: warnings.slice(0, WARNING_LOG_PREVIEW),
    truncated: warnings.length > WARNING_LOG_PREVIEW,
  });
}

async function applyStagedPopulation(
  client,
  plan,
  operation,
  repository,
) {
  await repository.resolveStage(client);
  const statusResult = await repository.resolutionStatus(client);
  const databaseWarnings = resolutionWarnings(statusResult.rows);

  const regionsUpdated = await repository.updateRegions(client);
  const citiesUpdated = await repository.updateCities(client);
  const updatedCities = citiesUpdated.rowCount ?? 0;

  if (updatedCities + databaseWarnings.length !== plan.cityCount) {
    throw new Error(
      'Population hierarchy import did not account for every staged city',
    );
  }

  const warnings = [...plan.warnings, ...databaseWarnings];
  const skippedCount = plan.skippedCityCount + databaseWarnings.length;
  const skippedRegions = plan.skippedRegionCount;
  reportWarnings(operation, warnings, skippedCount);

  await repository.syncActiveBoundaryPopulations(client);
  await client.query(RECALCULATE_CITY_STATISTICS_SQL);
  operation.onProgress?.({
    phase: 'database',
    regions: regionsUpdated.rowCount ?? 0,
    cities: updatedCities,
    skippedCities: skippedCount,
    skippedRegions,
    warnings: warnings.length,
  });

  return {
    regions: regionsUpdated.rowCount ?? 0,
    requestedRegions: plan.regionCount,
    uniqueRegions: plan.uniqueRegionCount,
    cities: updatedCities,
    requestedCities: plan.encounteredCityCount,
    normalizedCities: plan.cityCount,
    skippedCount,
    skippedRegionCount: skippedRegions,
    skippedCities: skippedCityLabels(warnings),
    warningCount: warnings.length,
    warnings,
    partial: skippedCount > 0 || skippedRegions > 0,
    asOf: plan.asOf,
    source: plan.source,
  };
}

/**
 * Population import never changes active state. Portable schema v3 may carry
 * OSM identity for regions/cities; when both osmType and osmId are present the
 * exact source object is resolved first. Legacy schema v2 and v3 entries that
 * omit both identity fields keep the normalized-name fallback inside the
 * selected region subtree.
 *
 * Invalid individual regions/cities and unresolved/ambiguous identities or
 * names are best-effort warnings: valid staged cities are still committed.
 * Transport, document-contract, resource-limit and unexpected database errors
 * remain fatal and roll back the transaction.
 *
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 */
export function createPopulationImportService(pool, dependencies = {}) {
  const repository =
    dependencies.repository ?? createPopulationImportRepository();

  return {
    async updateFromJsonStream(source, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await acquireDataImportLock(client, pool);
        throwIfAdminTaskCancelled(operation.signal);
        await repository.createRawStage(client);

        let rawBatch = [];
        const flushRaw = async () => {
          if (rawBatch.length === 0) return;
          const inserted = await repository.insertRawBatch(
            client,
            rawBatch,
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
        await repository.createStage(client);

        let lastRegionSeq = -1;
        let processedRegions = 0;
        let citySeq = 0;
        let staged = 0;
        for (;;) {
          throwIfAdminTaskCancelled(operation.signal);
          const regions = await repository.readRawBatch(
            client,
            lastRegionSeq,
            STREAM_STAGE_BATCH_SIZE,
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
              staged += await repository.insertStageBatch(
                client,
                batch,
                citySeq,
              );
              citySeq += batch.length;
            }
            lastRegionSeq = regionSeq;
            processedRegions += 1;
            operation.onProgress?.({
              phase: 'normalize-stage',
              staged,
              parsedRegions: parsed.itemCount,
              processedRegions,
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
          uniqueRegions: plan.uniqueRegionCount,
          cities: plan.cityCount,
          requestedCities: plan.encounteredCityCount,
          warnings: plan.warnings.length,
          skippedCities: plan.skippedCityCount,
          skippedRegions: plan.skippedRegionCount,
          asOf: plan.asOf,
          source: plan.source,
          decodedBytes: parsed.decodedBytes,
        });

        const result = await applyStagedPopulation(
          client,
          plan,
          operation,
          repository,
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
        uniqueRegions: plan.uniqueRegionCount,
        cities: plan.cityCount,
        requestedCities: plan.encounteredCityCount,
        warnings: plan.warnings.length,
        skippedCities: plan.skippedCityCount,
        skippedRegions: plan.skippedRegionCount,
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
          staged += await repository.insertStageBatch(
            client,
            batch,
            offset,
          );
        }
        if (staged !== plan.cityCount) {
          throw new Error('Not every normalized population city was staged');
        }

        const result = await applyStagedPopulation(
          client,
          plan,
          operation,
          repository,
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
