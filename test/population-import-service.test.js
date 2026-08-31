import assert from 'node:assert/strict';
import test from 'node:test';
import { createPopulationImportService } from '../src/db/population-import-service.js';

const upload = {
  asOf: '2026-01-01',
  source: 'test',
  populations: [{ name: 'Тестоград', population: 2000 }],
};

function createFakePool({ unknownCities = [] } = {}) {
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
        return { rows: [], rowCount: 1 };
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
  assert.equal(result.asOf, '2026-01-01');
  assert.equal(pool.queries[0], 'BEGIN');
  assert.match(pool.queries.at(-2), /^WITH geometry_statistics AS/);
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('population update rolls back when a city is unknown', async () => {
  const pool = createFakePool({ unknownCities: ['Нет такого города'] });
  const service = createPopulationImportService(pool);

  await assert.rejects(
    service.updateFromJson(upload),
    /Unknown cities: Нет такого города/,
  );

  assert.equal(pool.queries.at(-1), 'ROLLBACK');
  assert.equal(pool.released, true);
  assert.doesNotMatch(pool.queries.join('\n'), /INSERT INTO city_populations/);
});
