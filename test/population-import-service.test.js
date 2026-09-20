import assert from 'node:assert/strict';
import test from 'node:test';
import { createPopulationImportService } from '../src/db/population-import-service.js';

const upload = {
  asOf: '2026-01-01',
  source: 'test',
  populations: [{ name: 'Тестоград', population: 2000 }],
};

function createFakePool({
  unknownCities = [],
  ambiguousCities = [],
  updatedCities = 1,
} = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push(normalized);
      if (
        normalized.startsWith('INSERT INTO population_transfer_raw') ||
        normalized.startsWith('INSERT INTO population_transfer_stage')
      ) {
        return {
          rows: [],
          rowCount: values[0] ? JSON.parse(values[0]).length : 0,
        };
      }
      if (normalized.includes('COUNT(boundary.id)::integer AS match_count')) {
        const rows = [
          ...unknownCities.map((name) => ({ name, type: null, match_count: 0 })),
          ...ambiguousCities.map((name) => ({ name, type: null, match_count: 2 })),
        ];
        return { rows, rowCount: rows.length };
      }
      if (normalized.includes('INSERT INTO city_populations')) {
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
  assert.equal(result.ambiguousCount, 0);
  assert.deepEqual(result.ambiguousCities, []);
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


test('population update reports ambiguous legacy names instead of guessing', async () => {
  const pool = createFakePool({
    ambiguousCities: ['Октябрьский'],
    updatedCities: 0,
  });
  const service = createPopulationImportService(pool);

  const result = await service.updateFromJson({
    populations: [{ name: 'Октябрьский', population: 10000 }],
  });

  assert.equal(result.cities, 0);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.ambiguousCount, 1);
  assert.deepEqual(result.ambiguousCities, ['Октябрьский']);
  assert.equal(pool.queries.at(-1), 'COMMIT');
});


test('streamed population import rolls back staged records when JSON fails late', async () => {
  const populations = Array.from({ length: 101 }, (_value, index) => ({
    name: `Город ${index}`,
    population: 1000 + index,
  }));
  const malformed =
    '{"asOf":"2026-01-01","populations":' +
    JSON.stringify(populations) +
    ',"broken":';

  async function* source() {
    const buffer = Buffer.from(malformed);
    for (let offset = 0; offset < buffer.length; offset += 97) {
      yield buffer.subarray(offset, offset + 97);
    }
  }

  const pool = createFakePool();
  const service = createPopulationImportService(pool);

  await assert.rejects(
    service.updateFromJsonStream(source(), {
      maxJsonBytes: Buffer.byteLength(malformed) + 1,
      maxItemBytes: 1024 * 1024,
    }),
    /Unexpected end|JSON value/,
  );

  assert.equal(pool.queries[0], 'BEGIN');
  assert.equal(
    pool.queries.filter((query) =>
      query.startsWith('INSERT INTO population_transfer_raw')).length,
    1,
  );
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
  assert.equal(pool.queries.includes('COMMIT'), false);
  assert.doesNotMatch(pool.queries.join('\n'), /INSERT INTO city_populations/);
  assert.equal(pool.released, true);
});
