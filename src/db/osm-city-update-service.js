import crypto from 'node:crypto';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import { downloadOsmCities } from '../data/osm-city-downloader.js';
import {
  parseOsmCityResponse,
  parseOsmPlaceIdsResponse,
} from '../data/osm-city-parser.js';
import {
  normalizeOsmUpdateUrl,
  OsmCityUpdateValidationError,
  resolveOsmCityUpdateRequest,
} from '../data/osm-city-update-options.js';
import { createOsmBoundaryUpdateRepository } from '../modules/osm/boundary-update-repository.js';
import { createOverpassRequestSession } from '../modules/osm/overpass-request-session.js';
import {
  checkpointMode,
  checkpointSettingsFingerprint,
} from '../modules/osm/update-checkpoint-policy.js';
import {
  materializeReadyOsmCheckpoint,
  persistOsmCheckpointFailure,
  prepareOsmCheckpoint,
  preparePendingOsmGeometry,
} from '../modules/osm/update-checkpoint-session.js';
import { OsmCityGeometryError } from '../modules/osm/update-errors.js';
import { commitOsmBoundaryUpdate } from '../modules/osm/update-commit-session.js';
import { processOsmGeometryBatches } from '../modules/osm/update-geometry-session.js';
import { loadOsmUpdateIndex } from '../modules/osm/update-index-session.js';
import { createOsmRequestMetricsState } from '../modules/osm/update-request-metrics.js';
import { acquireDataImportLock } from './database-locks.js';
import { rebuildCityBoundaryHierarchy } from './city-boundary-hierarchy.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

/** @param {number} milliseconds @param {AbortSignal | undefined} signal */
function abortableDelay(milliseconds, signal) {
  throwIfAdminTaskCancelled(signal);
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      try {
        throwIfAdminTaskCancelled(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export { OsmCityGeometryError };

/**
 * Replace the complete Russian OSM place=city/town boundary snapshot atomically.
 * Geometry responses are downloaded sequentially into a session-local staging
 * table; production boundaries are changed only after every indexed object has
 * been downloaded and validated.
 *
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 * @param {any} config
 * @param {{
 *   download?: typeof downloadOsmCities,
 *   parseIndex?: typeof parseOsmPlaceIdsResponse,
 *   parseBatch?: typeof parseOsmCityResponse,
 *   reportProgress?: (progress: object) => void,
 *   sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
 *   now?: () => number,
 *   checkpointRepository?: ReturnType<
 *     import('./osm-city-checkpoint-repository.js').createOsmCityCheckpointRepository
 *   >,
 *   boundaryUpdateRepository?: ReturnType<
 *     typeof createOsmBoundaryUpdateRepository
 *   >
 * }} [dependencies]
 */
export function createOsmCityUpdateService(pool, config, dependencies = {}) {
  const download = dependencies.download ?? downloadOsmCities;
  const parseIndex = dependencies.parseIndex ?? parseOsmPlaceIdsResponse;
  const parseBatch = dependencies.parseBatch ?? parseOsmCityResponse;
  const settingsRepository = dependencies.settingsRepository;
  const checkpointRepository = dependencies.checkpointRepository;
  const boundaryUpdateRepository =
    dependencies.boundaryUpdateRepository ?? createOsmBoundaryUpdateRepository();
  const sleep = dependencies.sleep ?? abortableDelay;
  const now = dependencies.now ?? Date.now;
  const reportProgress = dependencies.reportProgress ?? ((progress) => {
    if (progress.phase === 'resume') {
      console.info(
        `OSM city update resumed checkpoint ${progress.checkpointId}: ` +
        `${progress.stagedPlaces}/${progress.indexedPlaces} already staged, ` +
        `${progress.remainingPlaces} remaining`,
      );
      return;
    }
    if (progress.phase === 'index') {
      console.info(
        `OSM city update index ${progress.indexPart}/${progress.indexPartCount}: ` +
        `${progress.indexedPlaces} place IDs loaded`,
      );
      return;
    }
    if (progress.phase === 'retry') {
      const reason = progress.retryKind === 'network'
        ? `network ${progress.networkCode ?? progress.networkMessage ?? 'failure'}`
        : `HTTP ${progress.statusCode}`;
      console.warn(
        `OSM city update ${reason}: retry ` +
        `${progress.attempt}/${progress.maxRetries} in ${progress.waitMs} ms`,
      );
      return;
    }
    if (progress.phase === 'split') {
      const reason = progress.reason === 'http-504'
        ? `HTTP 504 after ${progress.retryCount} retries`
        : `response exceeded ${progress.limitBytes} bytes`;
      console.warn(
        `OSM geometry batch ${progress.batch}: ${reason}; split ` +
        `${progress.objectCount} objects into ${progress.splitSizes.join('+')}`,
      );
      return;
    }
    if (progress.phase === 'hierarchy') {
      console.info(
        `OSM boundary hierarchy ${progress.processed}/${progress.total}: ` +
        `batch ${progress.batch}/${progress.batchCount}`,
      );
      return;
    }
    console.info(
      `OSM city update batch ${progress.batch}/${progress.batchCount}: ` +
      `${progress.stagedPlaces}/${progress.indexedPlaces} places staged`,
    );
  });

  return {
    async checkpointStatus() {
      if (!checkpointRepository) return null;
      await checkpointRepository.cleanup();
      return checkpointRepository.getResumable();
    },

    async discardCheckpoint() {
      if (!checkpointRepository) return null;
      const checkpoint = await checkpointRepository.getResumable();
      if (!checkpoint) return null;
      await checkpointRepository.discard(checkpoint.id);
      return checkpoint;
    },

    /**
     * @param {unknown} body
     * @param {Record<string, unknown>} query
     * @param {{ signal?: AbortSignal, onProgress?: (progress: object) => void, onCommit?: () => void }} operation
     */
    async update(body, query = {}, operation = {}) {
      throwIfAdminTaskCancelled(operation.signal);
      const savedSettings = settingsRepository
        ? await settingsRepository.get()
        : null;
      if (savedSettings?.sourceURL) {
        const savedSourceURL = normalizeOsmUpdateUrl(
          savedSettings.sourceURL,
          config.allowedHosts,
        );
        if (config.allowedURLs && !config.allowedURLs.has(savedSourceURL)) {
          throw new OsmCityUpdateValidationError(
            `Saved OSM URL is no longer allowed by deployment configuration: ${savedSourceURL}`,
          );
        }
      }
      const runtimeConfig = savedSettings
        ? {
            ...config,
            url: savedSettings.sourceURL,
            includeCity: savedSettings.includeCity,
            includeTown: savedSettings.includeTown,
            includeAdministrative: savedSettings.includeAdministrative,
            adminLevelMin: savedSettings.adminLevelMin,
            adminLevelMax: savedSettings.adminLevelMax,
            batchSize: savedSettings.batchSize,
            minDelayMs: savedSettings.minDelayMs,
            timeoutMs: savedSettings.timeoutMs,
            queryTimeoutSeconds: savedSettings.queryTimeoutSeconds,
            maxResponseBytes: savedSettings.maxResponseBytes,
            maxTotalBytes: savedSettings.maxTotalBytes,
            maxRetries: savedSettings.maxRetries,
            retryBaseDelayMs: savedSettings.retryBaseDelayMs,
            retryMaxDelayMs: savedSettings.retryMaxDelayMs,
          }
        : config;
      const options = resolveOsmCityUpdateRequest(body, query, runtimeConfig);
      const mode = checkpointMode(query);
      const settingsFingerprint = checkpointSettingsFingerprint(options);
      let checkpoint = await prepareOsmCheckpoint({
        checkpointRepository,
        mode,
        settingsFingerprint,
      });

      const checksumHash = crypto.createHash('sha256');
      const requestMetricsState = createOsmRequestMetricsState(
        mode.resume ? checkpoint : null,
      );
      const requestMetrics = requestMetricsState.metrics;
      const metricDelta = () => requestMetricsState.delta();
      const rememberPersistedMetrics = () =>
        requestMetricsState.rememberPersisted();
      const requestSession = createOverpassRequestSession({
        download,
        config,
        options,
        signal: operation.signal,
        sleep,
        now,
        metrics: requestMetrics,
        assertNotCancelled() {
          throwIfAdminTaskCancelled(operation.signal);
        },
        emitProgress(progress) {
          reportProgress(progress);
          operation.onProgress?.(progress);
        },
        onDownloaded(downloaded) {
          checksumHash
            .update(String(downloaded.bytes))
            .update(':')
            .update(downloaded.jsonText);
        },
      });
      const { downloadQuery } = requestSession;

      const loadedIndex = await loadOsmUpdateIndex({
        options,
        mode,
        checkpoint,
        checkpointRepository,
        settingsFingerprint,
        downloadQuery,
        parseIndex,
        requestMetrics,
        emitProgress(progress) {
          reportProgress(progress);
          operation.onProgress?.(progress);
        },
      });
      const {
        indexQueries,
        indexFinalURLs,
        index,
      } = loadedIndex;
      checkpoint = loadedIndex.checkpoint;
      if (loadedIndex.checkpointPersisted) {
        rememberPersistedMetrics();
      }

      const pendingState = await preparePendingOsmGeometry({
        checkpointRepository,
        checkpoint,
        index,
        mode,
        emitProgress(progress) {
          reportProgress(progress);
          operation.onProgress?.(progress);
        },
      });
      const {
        stagedKeys,
        pendingObjects,
      } = pendingState;
      let stagedPlaces = pendingState.stagedPlaces;
      let geometryPlaces = pendingState.geometryPlaces;
      let unbuildableGeometryPlaces =
        pendingState.unbuildableGeometryPlaces;

      const client = await pool.connect();
      try {
        throwIfAdminTaskCancelled(operation.signal);
        await boundaryUpdateRepository.dropStage(client);
        if (!checkpointRepository) {
          await boundaryUpdateRepository.createStage(client);
        }

        const geometryResult = await processOsmGeometryBatches({
          pendingObjects,
          options,
          indexedPlaces: index.objects.length,
          checkpoint,
          checkpointRepository,
          boundaryUpdateRepository,
          client,
          downloadQuery,
          parseBatch,
          metricDelta,
          rememberPersistedMetrics,
          initialStagedPlaces: stagedPlaces,
          initialGeometryPlaces: geometryPlaces,
          initialUnbuildableGeometryPlaces: unbuildableGeometryPlaces,
          initialIgnoredElements: mode.resume
            ? checkpoint.ignoredElements
            : 0,
          assertNotCancelled() {
            throwIfAdminTaskCancelled(operation.signal);
          },
          emitProgress(progress) {
            reportProgress(progress);
            operation.onProgress?.(progress);
          },
        });
        checkpoint = geometryResult.checkpoint;
        stagedPlaces = geometryResult.stagedPlaces;
        geometryPlaces = geometryResult.geometryPlaces;
        unbuildableGeometryPlaces =
          geometryResult.unbuildableGeometryPlaces;
        let cityPlaces = geometryResult.cityPlaces;
        let townPlaces = geometryResult.townPlaces;
        let administrativePlaces = geometryResult.administrativePlaces;
        let ignoredElements = geometryResult.ignoredElements;
        let duplicateNames = geometryResult.duplicateNames;
        let batchCount = geometryResult.batchCount;
        let checksum;

        if (checkpointRepository) {
          const ready = await materializeReadyOsmCheckpoint({
            checkpointRepository,
            boundaryUpdateRepository,
            client,
            checkpoint,
            index,
          });
          checkpoint = ready.checkpoint;
          geometryPlaces = ready.geometryPlaces;
          unbuildableGeometryPlaces = ready.unbuildableGeometryPlaces;
          cityPlaces = ready.cityPlaces;
          townPlaces = ready.townPlaces;
          administrativePlaces = ready.administrativePlaces;
          duplicateNames = ready.duplicateNames;
          ignoredElements = ready.ignoredElements;
          batchCount = ready.batchCount;
          checksum = ready.checksum;
        } else {
          checksum = checksumHash.digest('hex');
        }

        const stageCount = await boundaryUpdateRepository.stageCount(client);
        if (stageCount !== geometryPlaces) {
          throw new Error('Not every buildable OSM place was staged');
        }
        await boundaryUpdateRepository.assertValidStage(client);
        throwIfAdminTaskCancelled(operation.signal);

        if (checkpointRepository) {
          checkpoint = await checkpointRepository.getById(checkpoint.id);
          requestMetricsState.loadPersistedCheckpoint(checkpoint);
        }
        const requestMetricSnapshot = requestMetricsState.snapshot();

        const runValues = [
          options.url,
          checksum,
          requestMetricSnapshot.downloadedBytes,
          index.sourceElements,
          geometryPlaces,
          ignoredElements,
          index.osmTimestamp,
          cityPlaces,
          townPlaces,
          duplicateNames,
          administrativePlaces,
          index.duplicateIndexObjects,
          options.batchSize,
          batchCount,
        ];

        const commitResult = await commitOsmBoundaryUpdate({
          client,
          pool,
          boundaryUpdateRepository,
          checkpointRepository,
          checkpoint,
          osmTimestamp: index.osmTimestamp,
          geometryPlaces,
          dryRun: options.dryRun,
          runValues,
          acquireLock: acquireDataImportLock,
          rebuildHierarchy(boundaryClient, { onProgress }) {
            return rebuildCityBoundaryHierarchy(boundaryClient, {
              signal: operation.signal,
              onProgress,
            });
          },
          async syncDerivedData(boundaryClient) {
            // DELETE FROM city_boundaries temporarily clears boundary_id
            // through ON DELETE SET NULL. Restore exact OSM links before
            // synchronizing city_id so renamed/reassigned active boundaries
            // realign existing line rows in the same transaction.
            await boundaryClient.query('SELECT sync_active_boundary_cities()');
            await boundaryClient.query(
              'SELECT sync_active_boundary_populations()',
            );
            await boundaryClient.query(RECALCULATE_CITY_STATISTICS_SQL);
          },
          assertNotCancelled() {
            throwIfAdminTaskCancelled(operation.signal);
          },
          emitProgress(progress) {
            reportProgress(progress);
            operation.onProgress?.(progress);
          },
          onCommit: operation.onCommit,
        });

        const result = {
          dryRun: options.dryRun,
          sourceURL: options.url,
          indexFinalURLs: [...indexFinalURLs],
          indexRequestCount: indexQueries.length,
          downloadedBytes: requestMetricSnapshot.downloadedBytes,
          sourceElements: index.sourceElements,
          indexedPlaces: index.objects.length,
          importedPlaces: geometryPlaces,
          unbuildableGeometryPlaces,
          cityPlaces,
          townPlaces,
          administrativePlaces,
          duplicateIndexObjects: index.duplicateIndexObjects,
          duplicateNames,
          ignoredElements,
          batchSize: options.batchSize,
          batchCount,
          maxResponseBytes: options.maxResponseBytes,
          maxTotalBytes: options.maxTotalBytes,
          minDelayMs: options.minDelayMs,
          maxRetries: options.maxRetries,
          requestAttemptCount: requestMetricSnapshot.requestAttemptCount,
          retryCount: requestMetricSnapshot.retryCount,
          retryWaitMs: requestMetricSnapshot.retryWaitMs,
          throttleWaitMs: requestMetricSnapshot.throttleWaitMs,
          restoredGeometryLinks: commitResult.restoredGeometryLinks,
          osmTimestamp: index.osmTimestamp,
          checksum,
          checkpointId: checkpoint?.id ?? null,
          resumed: mode.resume,
          reusedObjects: stagedKeys.size,
          completedAt: new Date().toISOString(),
        };

        if (!commitResult.committed) {
          return {
            ...result,
            checkpointStatus: checkpointRepository ? 'ready' : null,
            resumable: Boolean(checkpointRepository),
          };
        }

        return {
          ...result,
          checkpointStatus: checkpointRepository ? 'completed' : null,
          resumable: false,
          updateRunId: commitResult.run.id,
          completedAt: commitResult.run.createdAt,
        };
      } catch (error) {
        try {
          await persistOsmCheckpointFailure({
            checkpointRepository,
            checkpoint,
            metricDelta,
            rememberPersistedMetrics,
            error,
            cancelled: Boolean(operation.signal?.aborted),
          });
        } catch (checkpointError) {
          console.error(
            'Failed to persist OSM checkpoint failure state',
            checkpointError,
          );
        }
        throw error;
      } finally {
        await boundaryUpdateRepository.dropStage(client).catch(() => {});
        client.release();
      }
    },
  };
}