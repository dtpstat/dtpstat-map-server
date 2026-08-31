import assert from 'node:assert/strict';
import test from 'node:test';
import { createDataImportService } from '../src/db/data-import-service.js';

const upload = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        short_name: 'Тестоград',
        name: 'Тестоград',
        population: 1000,
        lanes: 2,
        length: 50,
        lanes_length: 100,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [30, 60],
          [30.1, 60.1],
        ],
      },
    },
  ],
};

function createFakePool({ failOn } = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(text) {
      const normalized = text.trim();
      queries.push(normalized);
      if (failOn && normalized.includes(failOn)) {
        throw new Error('database failure');
      }
      if (normalized.startsWith('INSERT INTO city_geometries')) {
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith('WITH statistics AS')) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };

  return {
    queries,
    get released() {
      return released;
    },
    async connect() {
      return client;
    },
  };
}

test('data import replaces geometries and commits after updating statistics', async () => {
  const pool = createFakePool();
  const service = createDataImportService(pool);

  const result = await service.replaceFromGeoJson(upload);

  assert.equal(result.cities, 1);
  assert.equal(result.geometries, 1);
  assert.equal(pool.queries[0], 'BEGIN');
  assert.match(pool.queries.at(-2), /^WITH statistics AS/);
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('data import rolls back and releases its connection after a database error', async () => {
  const pool = createFakePool({ failOn: 'INSERT INTO city_geometries' });
  const service = createDataImportService(pool);

  await assert.rejects(service.replaceFromGeoJson(upload), /database failure/);

  assert.equal(pool.queries.at(-1), 'ROLLBACK');
  assert.equal(pool.released, true);
  assert.doesNotMatch(pool.queries.join('\n'), /COMMIT/);
});
