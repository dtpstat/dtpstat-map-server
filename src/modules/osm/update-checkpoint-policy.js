import crypto from 'node:crypto';
import { OsmCityUpdateValidationError } from '../../data/osm-city-update-options.js';

const OSM_CHECKPOINT_FORMAT_VERSION = 1;

export function sha256Json(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

export function checkpointOptionSnapshot(options) {
  return {
    formatVersion: OSM_CHECKPOINT_FORMAT_VERSION,
    sourceURL: options.url,
    includeCity: options.includeCity,
    includeTown: options.includeTown,
    includeAdministrative: options.includeAdministrative,
    adminLevelMin: options.adminLevelMin,
    adminLevelMax: options.adminLevelMax,
    queryTimeoutSeconds: options.queryTimeoutSeconds,
    batchSize: options.batchSize,
  };
}

export function checkpointSettingsFingerprint(options) {
  return sha256Json(checkpointOptionSnapshot(options));
}

export function checkpointIndexFingerprint(objects) {
  return sha256Json(objects.map((object) => ({
    osmType: object.osmType,
    osmId: object.osmId,
  })));
}

export function checkpointMode(query) {
  const resume = query.resume === 'true';
  const restart = query.restart === 'true';
  if (
    (query.resume !== undefined &&
      query.resume !== 'true' &&
      query.resume !== 'false') ||
    (query.restart !== undefined &&
      query.restart !== 'true' &&
      query.restart !== 'false')
  ) {
    throw new OsmCityUpdateValidationError(
      'resume and restart must equal true or false',
    );
  }
  if (resume && restart) {
    throw new OsmCityUpdateValidationError(
      'resume and restart cannot both be true',
    );
  }
  return { resume, restart };
}

export function checkpointErrorDetails(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    code: error?.code ?? null,
    statusCode: error?.statusCode ?? null,
    networkCode: error?.networkCode ?? null,
  };
}

export function addContentChecksums(places) {
  return places.map((place) => ({
    ...place,
    contentChecksum: sha256Json(place),
  }));
}

export function checkpointCompletionChecksum(checkpoint, objectChecksums) {
  return sha256Json({
    formatVersion: OSM_CHECKPOINT_FORMAT_VERSION,
    indexFingerprint: checkpoint.indexFingerprint,
    objects: objectChecksums,
  });
}
