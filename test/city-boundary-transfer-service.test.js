import assert from 'node:assert/strict';
import test from 'node:test';
import { createCityBoundaryTransferService } from '../src/db/city-boundary-transfer-service.js';

const snapshot = {
  type: 'FeatureCollection',
  schemaVersion: 1,
  features: [{
    type: 'Feature',
    properties: {
      placeType: 'city',
      osmType: 'relation',
      osmId: 12345,
      osmName: 'Тестоград',
      tags: { place: 'city', name: 'Тестоград' },
      osmTimestamp: '2026-09-01T12:00:00Z',
      updatedAt: '2026-09-01T13:00:00Z',
      city: {
        slug: 'testograd',
        name: 'Тестоград',
        fullName: 'Город Тестоград',
        attributes: { source: 'snapshot' },
      },
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [30, 60],
        [30.1, 60],
        [30.1, 60.1],
        [30, 60],
      ]],
    },
  }],
};

function createPool() {
  const queries = [];
  const parameters = [];
  let released = false;
  let releaseError;
  let stagedRows = 0;
  const client = {
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push(normalized);
      parameters.push(values);
      if (normalized.startsWith('INSERT INTO cities')) {
        return { rows: [], rowCount: JSON.parse(values[0]).length };
      }
      if (normalized.startsWith('WITH payload_rows AS')) {
        const rows = JSON.parse(values[0]).length;
        stagedRows += rows;
        return { rows: [], rowCount: rows };
      }
      if (normalized.startsWith('SELECT osm_type')) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith('INSERT INTO city_boundaries')) {
        return { rows: [], rowCount: stagedRows };
      }
      if (normalized.startsWith('UPDATE city_geometries')) {
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith('SELECT count(*)::integer')) {
        return { rows: [{ count: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release(error) {
      released = true;
      releaseError = error;
    },
  };
  return {
    queries,
    parameters,
    get released() { return released; },
    get releaseError() { return releaseError; },
    async connect() { return client; },
  };
}

test('city transfer restores city attributes, boundaries, and geometry links atomically', async () => {
  const pool = createPool();
  const progress = [];
  const service = createCityBoundaryTransferService(pool);
  const result = await service.replaceFromGeoJson(snapshot, {
    onProgress(value) { progress.push(value); },
  });

  assert.equal(result.importedPlaces, 1);
  assert.equal(result.importedCities, 1);
  assert.equal(result.linkedCities, 1);
  assert.equal(result.restoredGeometryLinks, 1);
  assert.equal(pool.queries[0], 'BEGIN');
  assert.ok(pool.queries.some((query) => query.startsWith('INSERT INTO cities')));
  assert.ok(pool.queries.some((query) => query.startsWith('DELETE FROM city_boundaries')));
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
  assert.equal(pool.releaseError, undefined);
  assert.equal(progress[0].phase, 'validated');
  assert.equal(progress.at(-1).phase, 'database');
  assert.equal(progress.find((value) => value.phase === 'stage').batchCount, 1);

  const cityInsertIndex = pool.queries.findIndex((query) => query.startsWith('INSERT INTO cities'));
  const boundaryDeleteIndex = pool.queries.indexOf('DELETE FROM city_boundaries');
  assert.ok(cityInsertIndex >= 0 && cityInsertIndex < boundaryDeleteIndex);
  const cityPayload = JSON.parse(pool.parameters[cityInsertIndex][0]);
  assert.deepEqual(cityPayload, [{
    slug: 'testograd',
    name: 'Тестоград',
    fullName: 'Город Тестоград',
    attributes: { source: 'snapshot' },
  }]);
});

test('city transfer stages large snapshots in bounded batches', async () => {
  const features = Array.from({ length: 121 }, (_value, index) => ({
    ...snapshot.features[0],
    properties: {
      ...snapshot.features[0].properties,
      osmId: 20000 + index,
      osmName: `Тестоград ${index}`,
      city: null,
    },
  }));
  const pool = createPool();
  const progress = [];
  const service = createCityBoundaryTransferService(pool);

  const result = await service.replaceFromGeoJson({
    type: 'FeatureCollection',
    schemaVersion: 1,
    features,
  }, {
    onProgress(value) { progress.push(value); },
  });

  assert.equal(result.importedPlaces, 121);
  const stageQueries = pool.queries.filter((query) =>
    query.startsWith('WITH payload_rows AS'));
  assert.equal(stageQueries.length, 3);
  const stageProgress = progress.filter((value) => value.phase === 'stage');
  assert.deepEqual(stageProgress.map((value) => value.batchPlaces), [50, 50, 21]);
  assert.deepEqual(stageProgress.map((value) => value.stagedPlaces), [50, 100, 121]);
  assert.ok(stageProgress.every((value) => value.payloadBytes > 0));
});

test('city transfer dryRun performs a full validation and rolls back', async () => {
  const pool = createPool();
  const service = createCityBoundaryTransferService(pool);
  const result = await service.replaceFromGeoJson(snapshot, { dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
  assert.doesNotMatch(pool.queries.join('\n'), /COMMIT/);
  assert.equal(pool.released, true);
});
