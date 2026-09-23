import { OsmCityDownloadError } from '../../data/osm-city-downloader.js';
import { buildOsmPlacesBatchQuery } from '../../data/osm-city-parser.js';
import { addContentChecksums } from './update-checkpoint-policy.js';
import {
  addNameCounts,
  assertCompleteBatch,
  createObjectBatches,
  objectKey,
} from './update-batch-policy.js';

/**
 * Download, validate, optionally split and stage all pending OSM geometry
 * batches. Production replacement is deliberately outside this session.
 */
export async function processOsmGeometryBatches({
  pendingObjects,
  options,
  indexedPlaces,
  checkpoint,
  checkpointRepository,
  boundaryUpdateRepository,
  client,
  downloadQuery,
  parseBatch,
  metricDelta,
  rememberPersistedMetrics,
  initialStagedPlaces = 0,
  initialGeometryPlaces = 0,
  initialUnbuildableGeometryPlaces = 0,
  initialIgnoredElements = 0,
  assertNotCancelled = () => {},
  emitProgress = () => {},
}) {
  const geometryBatches = createObjectBatches(
    pendingObjects,
    options.batchSize,
  );
  let currentCheckpoint = checkpoint;
  let stagedPlaces = initialStagedPlaces;
  let geometryPlaces = initialGeometryPlaces;
  let unbuildableGeometryPlaces = initialUnbuildableGeometryPlaces;
  let cityPlaces = 0;
  let townPlaces = 0;
  let administrativePlaces = 0;
  let ignoredElements = initialIgnoredElements;
  const nameCounts = new Map();

  for (let batchIndex = 0; batchIndex < geometryBatches.length;) {
    assertNotCancelled();
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

      if (!oversizedResponse && !exhausted504) {
        throw error;
      }

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
      emitProgress({
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
        indexedPlaces,
        stagedPlaces,
      });
      continue;
    }

    const parsed = parseBatch(batchDownload.jsonText);
    assertCompleteBatch(objects, parsed.places, batchNumber);

    let batchUnbuildableGeometryPlaces = 0;
    if (checkpointRepository) {
      currentCheckpoint = await checkpointRepository.stageBatch(
        currentCheckpoint.id,
        addContentChecksums(parsed.places),
        {
          ...metricDelta(),
          ignoredElements: parsed.ignoredElements,
        },
      );
      geometryPlaces = Number(currentCheckpoint.geometryObjects ?? 0);
      unbuildableGeometryPlaces = Number(
        currentCheckpoint.unbuildableGeometryObjects ?? 0,
      );
      batchUnbuildableGeometryPlaces = Number(
        currentCheckpoint.batchUnbuildableGeometryObjects ?? 0,
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

    assertNotCancelled();
    cityPlaces += parsed.cityPlaces;
    townPlaces += parsed.townPlaces;
    administrativePlaces += parsed.administrativePlaces ?? 0;
    ignoredElements += parsed.ignoredElements;
    stagedPlaces += parsed.places.length;
    addNameCounts(nameCounts, parsed.places);

    emitProgress({
      phase: 'geometry',
      batch: batchNumber,
      batchCount: geometryBatches.length,
      stagedPlaces,
      geometryPlaces,
      unbuildableGeometryPlaces,
      batchUnbuildableGeometryPlaces,
      indexedPlaces,
    });
    batchIndex += 1;
  }

  return {
    checkpoint: currentCheckpoint,
    stagedPlaces,
    geometryPlaces,
    unbuildableGeometryPlaces,
    cityPlaces,
    townPlaces,
    administrativePlaces,
    ignoredElements,
    duplicateNames: [...nameCounts.values()]
      .filter((count) => count > 1).length,
    batchCount: geometryBatches.length,
  };
}
