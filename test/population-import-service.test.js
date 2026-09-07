import assert from 'node:assert/strict';
import test from 'node:test';
import { createPopulationImportService } from '../src/db/population-import-service.js';

const upload = {
  asOf: '2026-01-01',
  source: 'test',
  populations: [{ name: 'Тестоград', population: 2000 }],
};

function createFakePool({ unknownCities = [], updatedCities = 1 } = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(text) {
      const normalized = text.trim();
      queries.push(normalized);
      if (normalized.startsWith('SELECT payload.name')) {
        return {
          rows: unknownCities.map((name) => ({ name })),
          rowCount: unknownCities.length,
        };
      }
      if (normalized.startsWith('INSERT INTO city_populations')) {
        return { rows: [], rowCount: updatedCities };
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

test('population update upserts data and recalculates city statistics', async () => {
  const pool = createFakePool();
  const service = createPopulationImportService(pool);

  const result = await service.updateFromJson(upload);

  assert.equal(result.cities, 1);
  assert.equal(result.requestedCities, 1);
  assert.equal(result.skippedCount, 0);
  assert.deepEqual(result.skippedCities, []);
  assert.equal(result.asOf, '2026-01-01');
  assert.equal(pool.queries[0], 'BEGIN');
  assert.match(pool.queries.at(-2), /^WITH geometry_statistics AS/);
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('population update skips cities that are absent from the database', async () => {
  const pool = createFakePool({
    unknownCities: ['Киров'],
    updatedCities: 1,
  });
  const service = createPopulationImportService(pool);
  const mixedUpload = {
    ...upload,
    populations: [
      { name: 'Тестоград', population: 2000 },
      { name: 'Киров', population: 450000 },
    ],
  };

  const result = await service.updateFromJson(mixedUpload);

  assert.equal(result.cities, 1);
  assert.equal(result.requestedCities, 2);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(result.skippedCities, ['Киров']);
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
  assert.match(pool.queries.join('\n'), /INSERT INTO city_populations/);
});
