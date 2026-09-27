import {
  buildRussianPlaceIdOverpassQueries,
} from './osm-city-parser.js';
import { OsmCityUpdateValidationError } from './osm-city-update-options.js';
import {
  checkpointIndexFingerprint,
  checkpointOptionSnapshot,
} from './update-checkpoint-policy.js';
import {
  combineIndexParts,
  objectKey,
} from './update-batch-policy.js';

/**
 * Load or reuse the OSM identity index for one update run.
 *
 * The function owns index-query composition, parser/result validation,
 * checkpoint index creation/replacement and index progress reporting.
 * Geometry download/staging and production replacement remain outside.
 */
export async function loadOsmUpdateIndex({
  options,
  mode,
  checkpoint,
  checkpointRepository,
  settingsFingerprint,
  downloadQuery,
  parseIndex,
  emitProgress = () => {},
  requestMetrics,
}) {
  const indexQueries = buildRussianPlaceIdOverpassQueries(
    options.queryTimeoutSeconds,
    options,
  );
  const indexFinalURLs = new Set();

  if (mode.resume) {
    const objects = await checkpointRepository.getIndexObjects(checkpoint.id);
    if (!Array.isArray(objects) || objects.length === 0) {
      throw new OsmCityUpdateValidationError(
        'Saved OSM checkpoint has no reusable object index',
      );
    }
    const actualIndexFingerprint = checkpointIndexFingerprint(objects);
    if (actualIndexFingerprint !== checkpoint.indexFingerprint) {
      throw new OsmCityUpdateValidationError(
        'Saved OSM checkpoint index fingerprint does not match its stored object index',
      );
    }
    indexFinalURLs.add(checkpoint.sourceURL);
    return {
      indexQueries,
      indexFinalURLs,
      index: {
        objects,
        sourceElements: checkpoint.sourceElements,
        duplicateIndexObjects: checkpoint.duplicateIndexObjects,
        osmTimestamp: checkpoint.osmTimestamp,
      },
      checkpoint,
      checkpointPersisted: false,
    };
  }

  const indexParts = [];
  const indexedKeys = new Set();
  for (const [partOffset, indexQuery] of indexQueries.entries()) {
    const indexDownload = await downloadQuery(indexQuery.query, {
      requestPhase: 'index',
      indexPart: partOffset + 1,
      indexPartCount: indexQueries.length,
    });
    const parsedPart = parseIndex(indexDownload.jsonText);
    const wrongType = parsedPart.objects.find((object) =>
      object.osmType !== indexQuery.osmType);
    if (wrongType) {
      throw new OsmCityUpdateValidationError(
        `OSM ${indexQuery.kind}/${indexQuery.osmType} index returned ${objectKey(wrongType)}`,
      );
    }

    indexParts.push(parsedPart);
    indexFinalURLs.add(indexDownload.finalURL);
    for (const object of parsedPart.objects) {
      indexedKeys.add(objectKey(object));
    }
    emitProgress({
      phase: 'index',
      indexPart: partOffset + 1,
      indexPartCount: indexQueries.length,
      indexedPlaces: indexedKeys.size,
    });
  }

  const index = combineIndexParts(indexParts);
  if (!checkpointRepository) {
    return {
      indexQueries,
      indexFinalURLs,
      index,
      checkpoint,
      checkpointPersisted: false,
    };
  }

  const checkpointValue = {
    sourceURL: options.url,
    settingsFingerprint,
    indexFingerprint: checkpointIndexFingerprint(index.objects),
    options: checkpointOptionSnapshot(options),
    indexObjects: index.objects.map((object) => ({
      osmType: object.osmType,
      osmId: object.osmId,
    })),
    sourceElements: index.sourceElements,
    duplicateIndexObjects: index.duplicateIndexObjects,
    osmTimestamp: index.osmTimestamp,
    downloadedBytes: requestMetrics.downloadedBytes,
    requestAttemptCount: requestMetrics.requestAttemptCount,
    retryCount: requestMetrics.retryCount,
    retryWaitMs: requestMetrics.retryWaitMs,
    throttleWaitMs: requestMetrics.throttleWaitMs,
  };
  const nextCheckpoint = checkpoint && mode.restart
    ? await checkpointRepository.replaceResumable(
        checkpoint.id,
        checkpointValue,
      )
    : await checkpointRepository.create(checkpointValue);

  return {
    indexQueries,
    indexFinalURLs,
    index,
    checkpoint: nextCheckpoint,
    checkpointPersisted: true,
  };
}
