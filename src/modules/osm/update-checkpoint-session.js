import { OsmCityUpdateValidationError } from '../../data/osm-city-update-options.js';
import {
  checkpointCompletionChecksum,
  checkpointErrorDetails,
} from './update-checkpoint-policy.js';
import { objectKey } from './update-batch-policy.js';

export async function prepareOsmCheckpoint({
  checkpointRepository,
  mode,
  settingsFingerprint,
}) {
  if ((mode.resume || mode.restart) && !checkpointRepository) {
    throw new OsmCityUpdateValidationError(
      'OSM resume mode is unavailable without checkpoint storage',
    );
  }
  if (!checkpointRepository) return null;

  await checkpointRepository.cleanup();
  const checkpoint = await checkpointRepository.getResumable();

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

  return checkpoint;
}

export async function preparePendingOsmGeometry({
  checkpointRepository,
  checkpoint,
  index,
  mode,
  emitProgress = () => {},
}) {
  const stagedKeys = checkpointRepository
    ? await checkpointRepository.getStagedKeys(checkpoint.id)
    : new Set();
  const stagedPlaces = stagedKeys.size;
  const geometryPlaces = checkpointRepository
    ? Number(checkpoint?.geometryObjects ?? 0)
    : stagedPlaces;
  const unbuildableGeometryPlaces = checkpointRepository
    ? Number(checkpoint?.unbuildableGeometryObjects ?? 0)
    : 0;
  const pendingObjects = checkpointRepository
    ? index.objects.filter((object) => !stagedKeys.has(objectKey(object)))
    : index.objects;

  if (mode.resume) {
    emitProgress({
      phase: 'resume',
      checkpointId: checkpoint.id,
      checkpointStatus: checkpoint.status,
      stagedPlaces,
      geometryPlaces,
      unbuildableGeometryPlaces,
      indexedPlaces: index.objects.length,
      remainingPlaces: pendingObjects.length,
    });
  }

  return {
    stagedKeys,
    stagedPlaces,
    geometryPlaces,
    unbuildableGeometryPlaces,
    pendingObjects,
  };
}

export async function materializeReadyOsmCheckpoint({
  checkpointRepository,
  boundaryUpdateRepository,
  client,
  checkpoint,
  index,
}) {
  let current = await checkpointRepository.getById(checkpoint.id);
  if (current.stagedObjects !== index.objects.length) {
    throw new Error(
      `OSM checkpoint contains ${current.stagedObjects}/` +
      `${index.objects.length} indexed objects`,
    );
  }

  current = await checkpointRepository.mark(current.id, 'ready');
  await boundaryUpdateRepository.dropStage(client);
  await boundaryUpdateRepository.materializeCheckpointStage(
    client,
    current.id,
  );

  const stats = await checkpointRepository.stats(current.id);
  const checksums = await checkpointRepository.checksums(current.id);

  return {
    checkpoint: current,
    geometryPlaces: Number(stats.geometryObjects ?? 0),
    unbuildableGeometryPlaces: Number(
      stats.unbuildableGeometryObjects ?? 0,
    ),
    cityPlaces: Number(stats.cityPlaces ?? 0),
    townPlaces: Number(stats.townPlaces ?? 0),
    administrativePlaces: Number(stats.administrativePlaces ?? 0),
    duplicateNames: Number(stats.duplicateNames ?? 0),
    ignoredElements: current.ignoredElements,
    batchCount: current.stagedBatchCount,
    checksum: checkpointCompletionChecksum(current, checksums),
  };
}

export async function persistOsmCheckpointFailure({
  checkpointRepository,
  checkpoint,
  metricDelta,
  rememberPersistedMetrics,
  error,
  cancelled,
}) {
  if (!checkpointRepository || !checkpoint) return;

  const delta = metricDelta();
  if (Object.values(delta).some((value) => value !== 0)) {
    await checkpointRepository.addMetrics(checkpoint.id, delta);
    rememberPersistedMetrics();
  }
  await checkpointRepository.mark(
    checkpoint.id,
    cancelled ? 'cancelled' : 'failed',
    checkpointErrorDetails(error),
  );
}
