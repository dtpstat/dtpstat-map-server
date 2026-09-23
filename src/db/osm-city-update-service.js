import crypto from 'node:crypto';
import { throwIfAdminTaskCancelled } from '../data/admin-task-manager.js';
import {
  downloadOsmCities,
  OsmCityDownloadError,
} from '../data/osm-city-downloader.js';
import {
  buildOsmPlacesBatchQuery,
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
  addNameCounts,
  assertCompleteBatch,
  createObjectBatches,
  objectKey,
} from '../modules/osm/update-batch-policy.js';
import {
  addContentChecksums,
  checkpointCompletionChecksum,
  checkpointErrorDetails,
  checkpointMode,
  checkpointSettingsFingerprint,
} from '../modules/osm/update-checkpoint-policy.js';
import { OsmCityGeometryError } from '../modules/osm/update-errors.js';
import { loadOsmUpdateIndex } from '../modules/osm/update-index-session.js';
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
      if ((mode.resume || mode.restart) && !checkpointRepository) {
        throw new OsmCityUpdateValidationError(
          'OSM resume mode is unavailable without checkpoint storage',
        );
      }

      const settingsFingerprint = checkpointSettingsFingerprint(options);
      if (checkpointRepository) await checkpointRepository.cleanup();
      let checkpoint = checkpointRepository
        ? await checkpointRepository.getResumable()
        : null;

      if (mode.resume) {
        if (!checkpoint) {
          throw new OsmCityUpdateValidationError(
            'No resumable OSM checkpoint exists',
          );
        }
        if (checkpoint.settingsFingerprint !== settingsFingerprint) {
          throw new OsmCityUpdateValidationError(
            'Saved OSM checkpoint is incompatible with current source/selectors/query/batch settings; restore those settings or start a new import explicitly',
          );
        }
      } else if (checkpoint && !mode.restart) {
        throw new OsmCityUpdateValidationError(
          'Unfinished OSM checkpoint ' + checkpoint.id + ' contains ' +
          checkpoint.stagedObjects + '/' + checkpoint.totalObjects +
          ' objects; resume it or explicitly start over',
        );
      }

      const checksumHash = crypto.createHash('sha256');
      let downloadedBytes = mode.resume ? checkpoint.downloadedBytes : 0;
      let requestAttemptCount = mode.resume
        ? checkpoint.requestAttemptCount
        : 0;
      let retryCount = mode.resume ? checkpoint.retryCount : 0;
      let retryWaitMs = mode.resume ? checkpoint.retryWaitMs : 0;
      let throttleWaitMs = mode.resume ? checkpoint.throttleWaitMs : 0;
      let persistedMetrics = {
        downloadedBytes,
        requestAttemptCount,
        retryCount,
        retryWaitMs,
        throttleWaitMs,
      };

      const metricDelta = () => ({
        downloadedBytes:
          downloadedBytes - persistedMetrics.downloadedBytes,
        requestAttemptCount:
          requestAttemptCount - persistedMetrics.requestAttemptCount,
        retryCount:
          retryCount - persistedMetrics.retryCount,
        retryWaitMs:
          retryWaitMs - persistedMetrics.retryWaitMs,
        throttleWaitMs:
          throttleWaitMs - persistedMetrics.throttleWaitMs,
      });

      const rememberPersistedMetrics = () => {
        persistedMetrics = {
          downloadedBytes,
          requestAttemptCount,
          retryCount,
          retryWaitMs,
          throttleWaitMs,
        };
      };

      const requestMetrics = {
        get downloadedBytes() { return downloadedBytes; },
        set downloadedBytes(value) { downloadedBytes = value; },
        get requestAttemptCount() { return requestAttemptCount; },
        set requestAttemptCount(value) { requestAttemptCount = value; },
        get retryCount() { return retryCount; },
        set retryCount(value) { retryCount = value; },
        get retryWaitMs() { return retryWaitMs; },
        set retryWaitMs(value) { retryWaitMs = value; },
        get throttleWaitMs() { return throttleWaitMs; },
        set throttleWaitMs(value) { throttleWaitMs = value; },
      };
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

      const stagedKeys = checkpointRepository
        ? await checkpointRepository.getStagedKeys(checkpoint.id)
        : new Set();
      let stagedPlaces = stagedKeys.size;
      let geometryPlaces = checkpointRepository
        ? Number(checkpoint?.geometryObjects ?? 0)
        : stagedPlaces;
      let unbuildableGeometryPlaces = checkpointRepository
        ? Number(checkpoint?.unbuildableGeometryObjects ?? 0)
        : 0;
      const pendingObjects = checkpointRepository
        ? index.objects.filter((object) => !stagedKeys.has(objectKey(object)))
        : index.objects;

      if (mode.resume) {
        const progress = {
          phase: 'resume',
          checkpointId: checkpoint.id,
          checkpointStatus: checkpoint.status,
          stagedPlaces,
          geometryPlaces,
          unbuildableGeometryPlaces,
          indexedPlaces: index.objects.length,
          remainingPlaces: pendingObjects.length,
        };
        reportProgress(progress);
        operation.onProgress?.(progress);
      }

      const geometryBatches = createObjectBatches(
        pendingObjects,
        options.batchSize,
      );
      const client = await pool.connect();
      let inTransaction = false;
      try {
        throwIfAdminTaskCancelled(operation.signal);
        await boundaryUpdateRepository.dropStage(client);
        if (!checkpointRepository) {
          await boundaryUpdateRepository.createStage(client);
        }
        let cityPlaces = 0;
        let townPlaces = 0;
        let administrativePlaces = 0;
        let ignoredElements = mode.resume
          ? checkpoint.ignoredElements
          : 0;
        const nameCounts = new Map();

        for (let batchIndex = 0; batchIndex < geometryBatches.length;) {
          throwIfAdminTaskCancelled(operation.signal);
          const objects = geometryBatches[batchIndex];
          const batchNumber = batchIndex + 1;
          let batchDownload;
          try {
            batchDownload = await downloadQuery(
              buildOsmPlacesBatchQuery(objects, options.queryTimeoutSeconds),
              {
                requestPhase: 'geometry',
                batch: batchNumber,
                batchCount: geometryBatches.length,
                objectCount: objects.length,
              },
            );
          } catch (error) {
            const oversizedResponse =
              error instanceof OsmCityDownloadError &&
              error.code === 'response-size-limit';
            const exhausted504 =
              error instanceof OsmCityDownloadError &&
              error.code === 'geometry-504-retry-limit' &&
              error.statusCode === 504;

            if (oversizedResponse || exhausted504) {
              if (objects.length === 1) {
                const object = objects[0];
                const objectError = new OsmCityDownloadError(
                  oversizedResponse
                    ? `OSM object ${objectKey(object)} exceeds the configured single-response size limit`
                    : `OSM object ${objectKey(object)} still returns HTTP 504 after ${options.maxRetries} retries`,
                  {
                    code: oversizedResponse
                      ? 'response-size-limit'
                      : 'retry-limit',
                    statusCode: error.statusCode,
                    limitBytes: options.maxResponseBytes,
                    receivedBytes: error.receivedBytes,
                    finalURL: error.finalURL,
                  },
                );
                objectError.cause = error;
                throw objectError;
              }

              const splitAt = Math.ceil(objects.length / 2);
              const left = objects.slice(0, splitAt);
              const right = objects.slice(splitAt);
              geometryBatches.splice(batchIndex, 1, left, right);
              const progress = {
                phase: 'split',
                requestPhase: 'geometry',
                reason: exhausted504 ? 'http-504' : 'response-size-limit',
                statusCode: exhausted504 ? 504 : undefined,
                retryCount: exhausted504 ? error.retryCount : 0,
                configuredMaxRetries: options.maxRetries,
                batch: batchNumber,
                batchCount: geometryBatches.length,
                objectCount: objects.length,
                splitSizes: [left.length, right.length],
                limitBytes: oversizedResponse
                  ? options.maxResponseBytes
                  : undefined,
                indexedPlaces: index.objects.length,
                stagedPlaces,
              };
              reportProgress(progress);
              operation.onProgress?.(progress);
              continue;
            }
            throw error;
          }

          const parsed = parseBatch(batchDownload.jsonText);
          assertCompleteBatch(objects, parsed.places, batchNumber);

          let batchUnbuildableGeometryPlaces = 0;
          if (checkpointRepository) {
            checkpoint = await checkpointRepository.stageBatch(
              checkpoint.id,
              addContentChecksums(parsed.places),
              {
                ...metricDelta(),
                ignoredElements: parsed.ignoredElements,
              },
            );
            geometryPlaces = Number(checkpoint.geometryObjects ?? 0);
            unbuildableGeometryPlaces = Number(
              checkpoint.unbuildableGeometryObjects ?? 0,
            );
            batchUnbuildableGeometryPlaces = Number(
              checkpoint.batchUnbuildableGeometryObjects ?? 0,
            );
            rememberPersistedMetrics();
          } else {
            await boundaryUpdateRepository.stageBatch(
              client,
              parsed.places,
              batchNumber,
            );
            geometryPlaces += parsed.places.length;
          }
          throwIfAdminTaskCancelled(operation.signal);

          cityPlaces += parsed.cityPlaces;
          townPlaces += parsed.townPlaces;
          administrativePlaces += parsed.administrativePlaces ?? 0;
          ignoredElements += parsed.ignoredElements;
          stagedPlaces += parsed.places.length;
          addNameCounts(nameCounts, parsed.places);
          const progress = {
            phase: 'geometry',
            batch: batchNumber,
            batchCount: geometryBatches.length,
            stagedPlaces,
            geometryPlaces,
            unbuildableGeometryPlaces,
            batchUnbuildableGeometryPlaces,
            indexedPlaces: index.objects.length,
          };
          reportProgress(progress);
          operation.onProgress?.(progress);
          batchIndex += 1;
        }

        let checksum;
        let duplicateNames = [...nameCounts.values()]
          .filter((count) => count > 1).length;
        let batchCount = geometryBatches.length;

        if (checkpointRepository) {
          checkpoint = await checkpointRepository.getById(checkpoint.id);
          if (checkpoint.stagedObjects !== index.objects.length) {
            throw new Error(
              `OSM checkpoint contains ${checkpoint.stagedObjects}/` +
              `${index.objects.length} indexed objects`,
            );
          }
          checkpoint = await checkpointRepository.mark(
            checkpoint.id,
            'ready',
          );
          await boundaryUpdateRepository.dropStage(client);
          await boundaryUpdateRepository.materializeCheckpointStage(
            client,
            checkpoint.id,
          );

          const stats = await checkpointRepository.stats(checkpoint.id);
          geometryPlaces = Number(stats.geometryObjects ?? 0);
          unbuildableGeometryPlaces = Number(
            stats.unbuildableGeometryObjects ?? 0,
          );
          cityPlaces = Number(stats.cityPlaces ?? 0);
          townPlaces = Number(stats.townPlaces ?? 0);
          administrativePlaces = Number(stats.administrativePlaces ?? 0);
          duplicateNames = Number(stats.duplicateNames ?? 0);
          ignoredElements = checkpoint.ignoredElements;
          batchCount = checkpoint.stagedBatchCount;
          const checksums = await checkpointRepository.checksums(
            checkpoint.id,
          );
          checksum = checkpointCompletionChecksum(checkpoint, checksums);
        } else {
          checksum = checksumHash.digest('hex');
        }

        const stageCount = await boundaryUpdateRepository.stageCount(client);
        if (stageCount !== geometryPlaces) {
          throw new Error('Not every buildable OSM place was staged');
        }
        await boundaryUpdateRepository.assertValidStage(client);
        throwIfAdminTaskCancelled(operation.signal);

        await client.query('BEGIN');
        inTransaction = true;
        await acquireDataImportLock(client, pool);
        await boundaryUpdateRepository.preserveLinks(client);
        throwIfAdminTaskCancelled(operation.signal);
        await boundaryUpdateRepository.deleteBoundaries(client);
        const boundaryResult = await boundaryUpdateRepository.insertBoundaries(
          client,
          index.osmTimestamp,
        );
        if (boundaryResult.rowCount !== geometryPlaces) {
          throw new Error('Not every buildable OSM boundary was inserted');
        }
        await boundaryUpdateRepository.activateNewPlaces(client);
        await rebuildCityBoundaryHierarchy(client, {
          signal: operation.signal,
          onProgress(progress) {
            reportProgress(progress);
            operation.onProgress?.(progress);
          },
        });
        const restoredLinksResult =
          await boundaryUpdateRepository.restoreGeometryLinks(client);
        // DELETE FROM city_boundaries temporarily clears boundary_id through
        // ON DELETE SET NULL. Restore exact OSM links before synchronizing
        // city_id so renamed/reassigned active boundaries can realign existing
        // line rows as part of the same transaction.
        await client.query('SELECT sync_active_boundary_cities()');
        await client.query('SELECT sync_active_boundary_populations()');
        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
        throwIfAdminTaskCancelled(operation.signal);

        if (checkpointRepository) {
          checkpoint = await checkpointRepository.getById(checkpoint.id);
          downloadedBytes = checkpoint.downloadedBytes;
          requestAttemptCount = checkpoint.requestAttemptCount;
          retryCount = checkpoint.retryCount;
          retryWaitMs = checkpoint.retryWaitMs;
          throttleWaitMs = checkpoint.throttleWaitMs;
        }

        const result = {
          dryRun: options.dryRun,
          sourceURL: options.url,
          indexFinalURLs: [...indexFinalURLs],
          indexRequestCount: indexQueries.length,
          downloadedBytes,
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
          requestAttemptCount,
          retryCount,
          retryWaitMs,
          throttleWaitMs,
          restoredGeometryLinks: restoredLinksResult.rowCount,
          osmTimestamp: index.osmTimestamp,
          checksum,
          checkpointId: checkpoint?.id ?? null,
          resumed: mode.resume,
          reusedObjects: stagedKeys.size,
          completedAt: new Date().toISOString(),
        };
        if (options.dryRun) {
          await client.query('ROLLBACK');
          inTransaction = false;
          return {
            ...result,
            checkpointStatus: checkpointRepository ? 'ready' : null,
            resumable: Boolean(checkpointRepository),
          };
        }

        const runResult = await boundaryUpdateRepository.insertRun(client, [
          options.url,
          checksum,
          downloadedBytes,
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
        ]);

        if (checkpointRepository) {
          await client.query(
            `DELETE FROM osm_city_update_checkpoint_stage
             WHERE checkpoint_id = $1`,
            [checkpoint.id],
          );
          await client.query(
            `UPDATE osm_city_update_checkpoints
             SET status = 'completed',
                 index_objects = '[]'::jsonb,
                 last_error = NULL,
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [checkpoint.id],
          );
        }

        throwIfAdminTaskCancelled(operation.signal);
        operation.onCommit?.();
        await client.query('COMMIT');
        inTransaction = false;
        return {
          ...result,
          checkpointStatus: checkpointRepository ? 'completed' : null,
          resumable: false,
          updateRunId: runResult.rows[0].id,
          completedAt: runResult.rows[0].createdAt,
        };
      } catch (error) {
        if (inTransaction) await client.query('ROLLBACK');
        if (checkpointRepository && checkpoint) {
          try {
            const delta = metricDelta();
            if (Object.values(delta).some((value) => value !== 0)) {
              await checkpointRepository.addMetrics(checkpoint.id, delta);
              rememberPersistedMetrics();
            }
            await checkpointRepository.mark(
              checkpoint.id,
              operation.signal?.aborted ? 'cancelled' : 'failed',
              checkpointErrorDetails(error),
            );
          } catch (checkpointError) {
            console.error(
              'Failed to persist OSM checkpoint failure state',
              checkpointError,
            );
          }
        }
        throw error;
      } finally {
        await boundaryUpdateRepository.dropStage(client).catch(() => {});
        client.release();
      }
    },
  };
}