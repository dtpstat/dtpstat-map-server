import {
  buildGeoJsonPlan,
  createGeoJsonAccumulator,
  GeoJsonValidationError,
} from '../data/geojson-plan.js';
import { parseStreamingJsonObject } from '../data/streaming-json.js';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import { createLineImportRepository } from '../modules/lines/import-repository.js';
import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

const STREAM_STAGE_BATCH_SIZE = 50;

/**
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 * @param {{
 *   repository?: ReturnType<typeof createLineImportRepository>,
 *   acquireLock?: typeof acquireDataImportLock,
 *   recalculateStatisticsSql?: string
 * }} [dependencies]
 */
export function createDataImportService(pool, dependencies = {}) {
  const repository =
    dependencies.repository ?? createLineImportRepository();
  const acquireLock =
    dependencies.acquireLock ?? acquireDataImportLock;
  const recalculateStatisticsSql =
    dependencies.recalculateStatisticsSql ?? RECALCULATE_CITY_STATISTICS_SQL;

  return {
    async replaceFromGeoJsonStream(source, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await acquireLock(client, pool);
        throwIfAdminTaskCancelled(operation.signal);
        await repository.createRawStage(client);

        let rawBatch = [];
        let rawBatches = 0;
        const flushRaw = async () => {
          if (rawBatch.length === 0) return;
          const result = await repository.insertRawBatch(client, rawBatch);
          if (result.rowCount !== rawBatch.length) {
            throw new Error('Not every streamed GeoJSON feature was staged');
          }
          rawBatches += 1;
          operation.onProgress?.({
            phase: 'raw-stage',
            batch: rawBatches,
            features: result.rowCount,
          });
          rawBatch = [];
        };

        const parsed = await parseStreamingJsonObject(source, {
          arrayKey: 'features',
          metadataKeys: new Set([
            'type',
            'name',
            'schemaVersion',
            'exportedAt',
            'lineTypes',
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
              dataSet: 'lines',
            });
          },
        });
        await flushRaw();

        if (parsed.metadata.type !== 'FeatureCollection') {
          throw new GeoJsonValidationError(
            'Request body must be a GeoJSON FeatureCollection',
          );
        }

        const accumulator = createGeoJsonAccumulator({
          lineTypes: parsed.metadata.lineTypes,
        });
        await repository.createNormalizedStage(client);

        let lastSeq = -1;
        let stagedGeometries = 0;
        for (;;) {
          throwIfAdminTaskCancelled(operation.signal);
          const rows = await repository.readRawBatch(
            client,
            lastSeq,
            STREAM_STAGE_BATCH_SIZE,
          );
          if (rows.rowCount === 0) break;

          const normalized = [];
          for (const row of rows.rows) {
            const seq = Number(row.seq);
            const geometry = accumulator.addFeature(row.item, seq);
            if (geometry) normalized.push({ seq, ...geometry });
            lastSeq = seq;
          }
          if (normalized.length > 0) {
            const inserted = await repository.insertNormalizedBatch(
              client,
              normalized,
            );
            if (inserted.rowCount !== normalized.length) {
              throw new Error(
                'Not every normalized line geometry was staged',
              );
            }
            stagedGeometries += inserted.rowCount;
          }
          operation.onProgress?.({
            phase: 'normalize-stage',
            processedFeatures: lastSeq + 1,
            stagedGeometries,
            parsedFeatures: parsed.itemCount,
          });
        }

        const plan = accumulator.finish(parsed.metadata);
        if (plan.geometryCount !== stagedGeometries) {
          throw new Error('Not every normalized line geometry was staged');
        }
        operation.onProgress?.({
          phase: 'validated',
          cities: plan.cities.length,
          geometries: plan.geometryCount,
          lineTypes: plan.lineTypes.length,
          ignoredFeatures: plan.ignoredFeatureCount,
          decodedBytes: parsed.decodedBytes,
        });

        await repository.upsertCities(client, plan.cities);

        const unknownBoundaries =
          await repository.findUnknownBoundaries(client);
        if (unknownBoundaries.rows.length > 0) {
          const objects = unknownBoundaries.rows
            .slice(0, 30)
            .map((row) => `${row.osm_type}/${row.osm_id}`)
            .join(', ');
          throw new GeoJsonValidationError(
            `Line GeoJSON references unknown or inactive city boundaries: ${objects}. Import/activate the OSM boundary snapshot first.`,
          );
        }

        const conflicts =
          await repository.findBoundaryCityConflicts(client);
        if (conflicts.rows.length > 0) {
          const objects = conflicts.rows
            .slice(0, 30)
            .map((row) => `${row.osm_type}/${row.osm_id}`)
            .join(', ');
          throw new GeoJsonValidationError(
            `Line GeoJSON conflicts with existing city-boundary links: ${objects}`,
          );
        }
        await repository.linkBoundaries(client);

        await repository.clearGeometries(client);
        await repository.applyLineTypeDictionary(client, plan.lineTypes);

        const unknownLineTypes =
          await repository.findUnknownLineTypes(client);
        if (unknownLineTypes.rows.length > 0) {
          throw new GeoJsonValidationError(
            `Line GeoJSON references unknown line type names: ${unknownLineTypes.rows.map((row) => row.line_type_name).join(', ')}`,
          );
        }

        const geometryResult = await repository.insertGeometries(client);
        const statisticsResult = await client.query(
          recalculateStatisticsSql,
        );
        if (geometryResult.rowCount !== plan.geometryCount) {
          throw new Error('Not every GeoJSON geometry was inserted');
        }
        if (statisticsResult.rowCount < plan.cities.length) {
          throw new Error('Not every city statistic was updated');
        }

        operation.onProgress?.({
          phase: 'database',
          cities: plan.cities.length,
          geometries: plan.geometryCount,
          lineTypes: plan.referencedLineTypes,
        });
        throwIfAdminTaskCancelled(operation.signal);

        operation.onCommit?.();
        await client.query('COMMIT');
        return {
          cities: plan.cities.length,
          geometries: plan.geometryCount,
          lineTypes: plan.referencedLineTypes,
          ignoredFeatures: plan.ignoredFeatureCount,
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

    async replaceFromGeoJson(collection, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const plan = buildGeoJsonPlan(collection);
      operation.onProgress?.({
        phase: 'validated',
        cities: plan.cities.length,
        geometries: plan.geometries.length,
        lineTypes: plan.lineTypes.length,
        ignoredFeatures: plan.ignoredFeatures.length,
      });
      throwIfAdminTaskCancelled(operation.signal);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await acquireLock(client, pool);
        throwIfAdminTaskCancelled(operation.signal);

        await repository.upsertCities(client, plan.cities);
        const serializedGeometries = JSON.stringify(plan.geometries);

        const unknownBoundaries =
          await repository.findUnknownBoundaries(
            client,
            serializedGeometries,
          );
        if (unknownBoundaries.rows.length > 0) {
          const objects = unknownBoundaries.rows
            .slice(0, 30)
            .map((row) => `${row.osm_type}/${row.osm_id}`)
            .join(', ');
          throw new GeoJsonValidationError(
            `Line GeoJSON references unknown or inactive city boundaries: ${objects}. Import/activate the OSM boundary snapshot first.`,
          );
        }

        const conflicts =
          await repository.findBoundaryCityConflicts(
            client,
            serializedGeometries,
          );
        if (conflicts.rows.length > 0) {
          const objects = conflicts.rows
            .slice(0, 30)
            .map((row) => `${row.osm_type}/${row.osm_id}`)
            .join(', ');
          throw new GeoJsonValidationError(
            `Line GeoJSON conflicts with existing city-boundary links: ${objects}`,
          );
        }
        await repository.linkBoundaries(
          client,
          serializedGeometries,
        );

        await repository.clearGeometries(client);
        await repository.applyLineTypeDictionary(
          client,
          plan.lineTypes,
        );

        const unknownLineTypes =
          await repository.findUnknownLineTypes(
            client,
            serializedGeometries,
          );
        if (unknownLineTypes.rows.length > 0) {
          throw new GeoJsonValidationError(
            `Line GeoJSON references unknown line type names: ${unknownLineTypes.rows.map((row) => row.line_type_name).join(', ')}`,
          );
        }

        const geometryResult = await repository.insertGeometries(
          client,
          serializedGeometries,
        );
        const statisticsResult = await client.query(
          recalculateStatisticsSql,
        );

        if (geometryResult.rowCount !== plan.geometries.length) {
          throw new Error('Not every GeoJSON geometry was inserted');
        }
        if (statisticsResult.rowCount < plan.cities.length) {
          throw new Error('Not every city statistic was updated');
        }

        const referencedLineTypes = [
          ...new Set(
            plan.geometries.map((geometry) => geometry.lineTypeName),
          ),
        ];
        operation.onProgress?.({
          phase: 'database',
          cities: plan.cities.length,
          geometries: plan.geometries.length,
          lineTypes: referencedLineTypes,
        });
        throwIfAdminTaskCancelled(operation.signal);

        operation.onCommit?.();
        await client.query('COMMIT');
        return {
          cities: plan.cities.length,
          geometries: plan.geometries.length,
          lineTypes: referencedLineTypes,
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
