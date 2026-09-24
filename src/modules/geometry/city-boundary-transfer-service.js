import { throwIfAdminTaskCancelled } from '../../shared/tasks/admin-task-manager.js';
import {
  buildCityBoundaryGeoJsonPlan,
  createCityBoundaryGeoJsonAccumulator,
} from '../../data/city-boundary-geojson-plan.js';
import { parseStreamingJsonObject } from '../../shared/streaming/streaming-json.js';
import {
  createCityBoundaryTransferRepository,
} from './city-boundary-transfer-repository.js';
// Keep each PostgreSQL jsonb/PostGIS conversion request bounded. The portable
// city snapshot can contain thousands of detailed MultiPolygons; sending the
// whole snapshot through one jsonb_to_recordset call creates an avoidable
// backend memory spike.
const STAGE_BATCH_SIZE = 50;

/** @param {unknown} error */
function errorDetails(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Atomically replace the complete OSM city/town boundary snapshot from a
 * portable GeoJSON export. Existing line-to-boundary links survive when the
 * same OSM object exists in the imported snapshot. Exact-boundary population
 * metadata and attributes travel with the boundary snapshot; active boundaries
 * are then projected into application-city population data before statistics
 * are recalculated.
 *
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 * @param {{
 *   repository?: ReturnType<typeof createCityBoundaryTransferRepository>,
 *   acquireLock: (client: any, pool: any) => Promise<void>,
 *   rebuildHierarchy: (
 *     client: any,
 *     options: { signal?: AbortSignal, onProgress?: (progress: object) => void }
 *   ) => Promise<any>,
 *   syncDerivedData: (client: any) => Promise<void>
 * }} dependencies
 */
export function createCityBoundaryTransferService(
  pool,
  dependencies,
) {
  const repository =
    dependencies?.repository ?? createCityBoundaryTransferRepository();
  const acquireLock = dependencies?.acquireLock;
  const rebuildHierarchy = dependencies?.rebuildHierarchy;
  const syncDerivedData = dependencies?.syncDerivedData;

  if (typeof acquireLock !== 'function') {
    throw new TypeError(
      'City boundary transfer acquireLock dependency is required',
    );
  }
  if (typeof rebuildHierarchy !== 'function') {
    throw new TypeError(
      'City boundary transfer rebuildHierarchy dependency is required',
    );
  }
  if (typeof syncDerivedData !== 'function') {
    throw new TypeError(
      'City boundary transfer syncDerivedData dependency is required',
    );
  }

  return {
    /**
     * Stream a portable city GeoJSON snapshot into PostgreSQL staging while one
     * transaction is open. Only one feature batch is materialized in JS at a
     * time; any parser/ZIP/PostGIS error rolls the complete transaction back.
     *
     * @param {AsyncIterable<Buffer | Uint8Array | string>} source
     * @param {{
     *   dryRun?: boolean,
     *   maxJsonBytes: number,
     *   maxItemBytes: number,
     *   signal?: AbortSignal,
     *   onProgress?: (progress: object) => void,
     *   onCommit?: () => void
     * }} operation
     */
    async replaceFromGeoJsonStream(source, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const client = await pool.connect();
      let discardClientError;
      try {
        await client.query('BEGIN');
        await acquireLock(client, pool);
        throwIfAdminTaskCancelled(operation.signal);
        await repository.createStage(client);

        const accumulator = createCityBoundaryGeoJsonAccumulator();
        let stagedPlaces = 0;
        let batchNumber = 0;
        let batch = [];

        const flush = async () => {
          if (batch.length === 0) return;
          const payload = JSON.stringify(batch);
          const nextBatch = batchNumber + 1;
          operation.onProgress?.({
            phase: 'stage-write',
            batch: nextBatch,
            batchPlaces: batch.length,
            stagedPlaces,
            payloadBytes: Buffer.byteLength(payload),
          });
          const stageResult = await repository.insertStageBatch(
            client,
            batch,
          );
          if (stageResult.rowCount !== batch.length) {
            throw new Error('Not every city boundary was staged');
          }
          stagedPlaces += stageResult.rowCount;
          batchNumber = nextBatch;
          operation.onProgress?.({
            phase: 'stage',
            batch: batchNumber,
            batchPlaces: batch.length,
            stagedPlaces,
            payloadBytes: Buffer.byteLength(payload),
          });
          batch = [];
        };

        const parsed = await parseStreamingJsonObject(source, {
          arrayKey: 'features',
          metadataKeys: new Set([
            'type',
            'name',
            'schemaVersion',
            'exportedAt',
          ]),
          maxBytes: operation.maxJsonBytes,
          maxItemBytes: operation.maxItemBytes,
          maxDepth: operation.maxJsonDepth,
          maxItems: operation.maxJsonItems,
          signal: operation.signal,
          async onItem(feature, featureIndex) {
            throwIfAdminTaskCancelled(operation.signal);
            batch.push(accumulator.addFeature(feature, featureIndex));
            if (batch.length >= STAGE_BATCH_SIZE) await flush();
          },
          onProgress(progress) {
            operation.onProgress?.({
              ...progress,
              dataSet: 'cities',
            });
          },
        });
        await flush();

        const plan = accumulator.finish(parsed.metadata);
        if (
          stagedPlaces !== parsed.itemCount ||
          stagedPlaces !== plan.boundaryCount
        ) {
          throw new Error('Not every streamed city boundary was staged');
        }
        operation.onProgress?.({
          phase: 'validated',
          places: stagedPlaces,
          cities: plan.cities.length,
          decodedBytes: parsed.decodedBytes,
        });

        if (plan.cities.length > 0) {
          const cityResult = await repository.upsertCities(
            client,
            plan.cities,
          );
          if (cityResult.rowCount !== plan.cities.length) {
            throw new Error('Not every linked city record was imported');
          }
        }

        operation.onProgress?.({
          phase: 'validate-stage',
          places: stagedPlaces,
        });
        const invalidResult = await repository.findInvalidStage(client);
        if (invalidResult.rows.length > 0) {
          const names = invalidResult.rows
            .slice(0, 20)
            .map((row) => `${row.osm_type}/${row.osm_id} ${row.osm_name}`)
            .join(', ');
          throw new Error(
            `Imported city boundaries contain invalid polygons: ${names}`,
          );
        }

        operation.onProgress?.({ phase: 'preserve-links' });
        await repository.preserveGeometryLinks(client);
        operation.onProgress?.({
          phase: 'delete-boundaries',
          places: stagedPlaces,
        });
        await repository.deleteBoundaries(client);
        operation.onProgress?.({
          phase: 'insert-boundaries',
          places: stagedPlaces,
        });
        const inserted = await repository.insertBoundaries(client);
        if (inserted.rowCount !== stagedPlaces) {
          throw new Error('Not every city boundary was imported');
        }

        await rebuildHierarchy(client, {
          signal: operation.signal,
          onProgress: operation.onProgress,
        });
        operation.onProgress?.({
          phase: 'restore-links',
          places: inserted.rowCount,
        });
        const restored = await repository.restoreGeometryLinks(client);
        await syncDerivedData(client);
        throwIfAdminTaskCancelled(operation.signal);

        const linkedResult = await repository.linkedCityCount(client);
        const result = {
          dryRun: Boolean(operation.dryRun),
          importedPlaces: stagedPlaces,
          importedCities: plan.cities.length,
          linkedCities: linkedResult.rows[0]?.count ?? 0,
          restoredGeometryLinks: restored.rowCount,
          decodedBytes: parsed.decodedBytes,
          streamed: true,
          completedAt: new Date().toISOString(),
        };
        operation.onProgress?.({
          phase: 'database',
          places: result.importedPlaces,
          cities: result.importedCities,
          linkedCities: result.linkedCities,
          restoredGeometryLinks: result.restoredGeometryLinks,
        });

        if (operation.dryRun) {
          await client.query('ROLLBACK');
          return result;
        }
        operation.onCommit?.();
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          discardClientError = rollbackError;
          operation.onProgress?.({
            phase: 'rollback-failed',
            error: errorDetails(rollbackError),
          });
        }
        throw error;
      } finally {
        client.release(discardClientError);
      }
    },

    /**
     * @param {unknown} collection
     * @param {{ dryRun?: boolean, signal?: AbortSignal, onProgress?: (progress: object) => void, onCommit?: () => void }} operation
     */
    async replaceFromGeoJson(collection, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const plan = buildCityBoundaryGeoJsonPlan(collection);
      operation.onProgress?.({
        phase: 'validated',
        places: plan.boundaries.length,
        cities: plan.cities.length,
      });
      const client = await pool.connect();
      let discardClientError;
      try {
        await client.query('BEGIN');
        await acquireLock(client, pool);
        throwIfAdminTaskCancelled(operation.signal);

        if (plan.cities.length > 0) {
          const cityResult = await repository.upsertCities(
            client,
            plan.cities,
          );
          if (cityResult.rowCount !== plan.cities.length) {
            throw new Error('Not every linked city record was imported');
          }
        }
        operation.onProgress?.({
          phase: 'cities',
          cities: plan.cities.length,
        });

        await repository.createStage(client);
        const batchCount = Math.ceil(
          plan.boundaries.length / STAGE_BATCH_SIZE,
        );
        let stagedPlaces = 0;
        for (
          let offset = 0;
          offset < plan.boundaries.length;
          offset += STAGE_BATCH_SIZE
        ) {
          throwIfAdminTaskCancelled(operation.signal);
          const batch = plan.boundaries.slice(
            offset,
            offset + STAGE_BATCH_SIZE,
          );
          const payload = JSON.stringify(batch);
          const batchNumber =
            Math.floor(offset / STAGE_BATCH_SIZE) + 1;
          operation.onProgress?.({
            phase: 'stage-write',
            batch: batchNumber,
            batchCount,
            batchPlaces: batch.length,
            stagedPlaces,
            places: plan.boundaries.length,
            payloadBytes: Buffer.byteLength(payload),
          });
          const stageResult = await repository.insertStageBatch(
            client,
            batch,
          );
          if (stageResult.rowCount !== batch.length) {
            throw new Error('Not every city boundary was staged');
          }
          stagedPlaces += stageResult.rowCount;
          operation.onProgress?.({
            phase: 'stage',
            batch: batchNumber,
            batchCount,
            batchPlaces: batch.length,
            stagedPlaces,
            places: plan.boundaries.length,
            payloadBytes: Buffer.byteLength(payload),
          });
        }
        if (stagedPlaces !== plan.boundaries.length) {
          throw new Error('Not every city boundary was staged');
        }

        operation.onProgress?.({
          phase: 'validate-stage',
          places: stagedPlaces,
        });
        const invalidResult = await repository.findInvalidStage(client);
        if (invalidResult.rows.length > 0) {
          const names = invalidResult.rows
            .slice(0, 20)
            .map((row) => `${row.osm_type}/${row.osm_id} ${row.osm_name}`)
            .join(', ');
          throw new Error(
            `Imported city boundaries contain invalid polygons: ${names}`,
          );
        }

        operation.onProgress?.({ phase: 'preserve-links' });
        await repository.preserveGeometryLinks(client);
        operation.onProgress?.({
          phase: 'delete-boundaries',
          places: plan.boundaries.length,
        });
        await repository.deleteBoundaries(client);
        operation.onProgress?.({
          phase: 'insert-boundaries',
          places: plan.boundaries.length,
        });
        const inserted = await repository.insertBoundaries(client);
        if (inserted.rowCount !== plan.boundaries.length) {
          throw new Error('Not every city boundary was imported');
        }
        await rebuildHierarchy(client, {
          signal: operation.signal,
          onProgress: operation.onProgress,
        });
        operation.onProgress?.({
          phase: 'restore-links',
          places: inserted.rowCount,
        });
        const restored = await repository.restoreGeometryLinks(client);
        // Restore boundary_id first: synchronizing active boundaries may
        // reassign their application city and must update existing line rows
        // against the restored exact OSM object.
        await syncDerivedData(client);
        throwIfAdminTaskCancelled(operation.signal);

        const linkedResult = await repository.linkedCityCount(client);
        const result = {
          dryRun: Boolean(operation.dryRun),
          importedPlaces: plan.boundaries.length,
          importedCities: plan.cities.length,
          linkedCities: linkedResult.rows[0]?.count ?? 0,
          restoredGeometryLinks: restored.rowCount,
          completedAt: new Date().toISOString(),
        };
        operation.onProgress?.({
          phase: 'database',
          places: result.importedPlaces,
          cities: result.importedCities,
          linkedCities: result.linkedCities,
          restoredGeometryLinks: result.restoredGeometryLinks,
        });

        if (operation.dryRun) {
          await client.query('ROLLBACK');
          return result;
        }
        operation.onCommit?.();
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          discardClientError = rollbackError;
          operation.onProgress?.({
            phase: 'rollback-failed',
            error: errorDetails(rollbackError),
          });
        }
        throw error;
      } finally {
        client.release(discardClientError);
      }
    },
  };
}
