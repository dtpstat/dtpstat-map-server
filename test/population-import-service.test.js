import assert from 'node:assert/strict';
import test from 'node:test';
import { createPopulationImportService } from '../src/db/population-import-service.js';

const upload = {
  schemaVersion: 2,
  asOf: '2026-01-01',
  source: 'test',
  territories: [{
    osmType: 'relation',
    osmId: '123',
    name: 'Тестоград',
    type: 'city',
    placeType: 'city',
    adminLevel: 6,
    population: 2000,
    attributes: {},
    children: [],
  }],
};

function createFakePool({
  statuses = [{ osmType: 'relation', osmId: '123', name: 'Тестоград', status: 'matched' }],
  updatedTerritories = 1,
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
      if (normalized.startsWith('SELECT') && normalized.includes('AS status')) {
        return { rows: statuses, rowCount: statuses.length };
      }
      if (normalized.startsWith('UPDATE city_boundaries AS boundary')) {
        return {
          rows: Array.from({ length: updatedTerritories }, (_v, index) => ({ id: index + 1 })),
          rowCount: updatedTerritories,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };

  return {
    queries,
    get released() { return released; },
    async connect() { return client; },
  };
}

test('population update writes territory data and refreshes active projection', async () => {
  const pool = createFakePool();
  const service = createPopulationImportService(pool);

  const result = await service.updateFromJson(upload);

  assert.equal(result.territories, 1);
  assert.equal(result.requestedTerritories, 1);
  assert.equal(result.skippedCount, 0);
  assert.deepEqual(result.skippedTerritories, []);
  assert.equal(result.asOf, '2026-01-01');
  assert.equal(pool.queries[0], 'BEGIN');
  assert.ok(pool.queries.includes('SELECT sync_active_boundary_populations()'));
  assert.match(pool.queries.at(-2), /^WITH geometry_statistics AS/);
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('population update skips OSM territories absent from target', async () => {
  const pool = createFakePool({
    statuses: [
      { osmType: 'relation', osmId: '123', name: 'Тестоград', status: 'matched' },
      { osmType: 'relation', osmId: '999', name: 'Нет в БД', status: 'missing' },
    ],
    updatedTerritories: 1,
  });
  const service = createPopulationImportService(pool);
  const mixed = {
    ...upload,
    territories: [
      upload.territories[0],
      {
        ...upload.territories[0],
        osmId: '999',
        name: 'Нет в БД',
      },
    ],
  };

  const result = await service.updateFromJson(mixed);

  assert.equal(result.territories, 1);
  assert.equal(result.requestedTerritories, 2);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(
    result.skippedTerritories,
    ['relation/999 Нет в БД'],
  );
  assert.equal(pool.queries.at(-1), 'COMMIT');
});

test('population update rejects a hierarchy mismatch for known territories', async () => {
  const pool = createFakePool({
    statuses: [
      { osmType: 'relation', osmId: '123', name: 'Тестоград', status: 'hierarchy' },
    ],
    updatedTerritories: 0,
  });
  const service = createPopulationImportService(pool);

  await assert.rejects(
    service.updateFromJson(upload),
    /hierarchy does not match/,
  );
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
});

test('streamed population import rolls back staged roots when JSON fails late', async () => {
  const roots = Array.from({ length: 101 }, (_value, index) => ({
    ...upload.territories[0],
    osmId: String(1000 + index),
    name: `Территория ${index}`,
  }));
  const malformed =
    '{"schemaVersion":2,"territories":' +
    JSON.stringify(roots) +
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
      maxJsonItems: 1000,
      maxJsonDepth: 128,
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
  assert.equal(pool.released, true);
});
