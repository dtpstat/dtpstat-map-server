import assert from 'node:assert/strict';
import test from 'node:test';
import { OsmCityUpdateValidationError } from '../src/data/osm-city-update-options.js';
import {
  addContentChecksums,
  checkpointCompletionChecksum,
  checkpointErrorDetails,
  checkpointIndexFingerprint,
  checkpointMode,
  checkpointOptionSnapshot,
  checkpointSettingsFingerprint,
} from '../src/modules/osm/update-checkpoint-policy.js';

const options = {
  url: 'https://overpass-api.de/api/interpreter',
  includeCity: true,
  includeTown: true,
  includeAdministrative: true,
  adminLevelMin: 4,
  adminLevelMax: 8,
  queryTimeoutSeconds: 180,
  batchSize: 25,
  minDelayMs: 1000,
};

test('OSM checkpoint policy fingerprints only resume-compatible settings', () => {
  const snapshot = checkpointOptionSnapshot(options);
  assert.deepEqual(snapshot, {
    formatVersion: 1,
    sourceURL: options.url,
    includeCity: true,
    includeTown: true,
    includeAdministrative: true,
    adminLevelMin: 4,
    adminLevelMax: 8,
    queryTimeoutSeconds: 180,
    batchSize: 25,
  });

  assert.equal(
    checkpointSettingsFingerprint(options),
    checkpointSettingsFingerprint({
      ...options,
      minDelayMs: 999999,
    }),
  );
  assert.notEqual(
    checkpointSettingsFingerprint(options),
    checkpointSettingsFingerprint({
      ...options,
      batchSize: 10,
    }),
  );
});

test('OSM checkpoint index fingerprint is deterministic for ordered identity', () => {
  const objects = [
    { osmType: 'relation', osmId: 10, ignored: true },
    { osmType: 'way', osmId: 20, ignored: true },
  ];
  assert.equal(
    checkpointIndexFingerprint(objects),
    checkpointIndexFingerprint([
      { osmType: 'relation', osmId: 10 },
      { osmType: 'way', osmId: 20 },
    ]),
  );
  assert.notEqual(
    checkpointIndexFingerprint(objects),
    checkpointIndexFingerprint([...objects].reverse()),
  );
});

test('OSM checkpoint mode validates resume and restart flags', () => {
  assert.deepEqual(checkpointMode({}), {
    resume: false,
    restart: false,
  });
  assert.deepEqual(checkpointMode({ resume: 'true' }), {
    resume: true,
    restart: false,
  });
  assert.deepEqual(checkpointMode({ restart: 'true' }), {
    resume: false,
    restart: true,
  });

  assert.throws(
    () => checkpointMode({ resume: 'yes' }),
    OsmCityUpdateValidationError,
  );
  assert.throws(
    () => checkpointMode({ resume: 'true', restart: 'true' }),
    /cannot both be true/,
  );
});

test('OSM checkpoint policy preserves failure metadata without Error coupling', () => {
  const error = Object.assign(new Error('failed'), {
    code: 'retry-limit',
    statusCode: 504,
    networkCode: 'ETIMEDOUT',
  });
  assert.deepEqual(checkpointErrorDetails(error), {
    name: 'Error',
    message: 'failed',
    code: 'retry-limit',
    statusCode: 504,
    networkCode: 'ETIMEDOUT',
  });
  assert.deepEqual(checkpointErrorDetails('plain failure'), {
    name: 'Error',
    message: 'plain failure',
    code: null,
    statusCode: null,
    networkCode: null,
  });
});

test('OSM checkpoint content checksums and completion checksum are stable', () => {
  const places = [
    { osmType: 'relation', osmId: 10, name: 'Первый' },
    { osmType: 'way', osmId: 20, name: 'Второй' },
  ];
  const checksummed = addContentChecksums(places);
  assert.equal(checksummed.length, 2);
  assert.equal(typeof checksummed[0].contentChecksum, 'string');
  assert.equal(checksummed[0].contentChecksum.length, 64);
  assert.equal(checksummed[0].name, 'Первый');

  const checkpoint = { indexFingerprint: 'index-fingerprint' };
  const objectChecksums = checksummed.map((item) => ({
    osmType: item.osmType,
    osmId: String(item.osmId),
    contentChecksum: item.contentChecksum,
  }));
  assert.equal(
    checkpointCompletionChecksum(checkpoint, objectChecksums),
    checkpointCompletionChecksum(checkpoint, structuredClone(objectChecksums)),
  );
});
