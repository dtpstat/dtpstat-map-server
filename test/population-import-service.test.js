import assert from 'node:assert/strict';
import test from 'node:test';
import { createPopulationImportService } from '../src/db/population-import-service.js';

const upload = {
  schemaVersion: 2,
  asOf: '2026-01-01',
  source: 'test',
  regions: [{
    name: 'Тестовая область',
    attributes: { federalDistrict: 'Тестовый округ' },
    cities: [{
      name: 'Тестоград',
      population: 2000,
      attributes: {},
    }],
  }],
};

function createFakePool({
  statuses = [{
    regionName: 'Тестовая область',
    cityName: 'Тестоград',
    status: 'matched',
  }],
  updatedRegions = 1,
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
      if (
        normalized.startsWith('SELECT') &&
        normalized.includes('FROM population_transfer_resolved')
      ) {
        return { rows: statuses, rowCount: statuses.length };
      }
      if (
        normalized.startsWith('UPDATE city_boundaries AS boundary') &&
        normalized.includes('source.region_attributes')
      ) {
        return {
          rows: Array.from({ length: updatedRegions }, (_v, index) => ({ id: index + 1 })),
          rowCount: updatedRegions,
        };
      }
      if (
        normalized.startsWith('UPDATE city_boundaries AS boundary') &&
        normalized.includes('population = stage.population')
      ) {
        return {
          rows: Array.from({ length: updatedCities }, (_v, index) => ({ id: index + 1 })),
          rowCount: updatedCities,
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

test('population update matches city names inside a named region', async () => {
  const pool = createFakePool();
  const service = createPopulationImportService(pool);

  const result = await service.updateFromJson(upload);

  assert.equal(result.regions, 1);
  assert.equal(result.requestedRegions, 1);
  assert.equal(result.cities, 1);
  assert.equal(result.requestedCities, 1);
  assert.equal(result.skippedCount, 0);
  assert.deepEqual(result.skippedCities, []);
  assert.equal(result.asOf, '2026-01-01');
  assert.equal(pool.queries[0], 'BEGIN');
  assert.ok(
    pool.queries.some((query) =>
      query.startsWith('CREATE TEMP TABLE population_transfer_resolved')),
  );
  assert.ok(pool.queries.includes('SELECT sync_active_boundary_populations()'));
  assert.match(pool.queries.at(-2), /^WITH geometry_statistics AS/);
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('population update skips missing regions or cities', async () => {
  const pool = createFakePool({
    statuses: [
      {
        regionName: 'Тестовая область',
        cityName: 'Тестоград',
        status: 'matched',
      },
      {
        regionName: 'Тестовая область',
        cityName: 'Нет в БД',
        status: 'city-missing',
      },
    ],
    updatedCities: 1,
  });
  const service = createPopulationImportService(pool);
  const mixed = {
    ...upload,
    regions: [{
      ...upload.regions[0],
      cities: [
        upload.regions[0].cities[0],
        { name: 'Нет в БД', population: 1000, attributes: {} },
      ],
    }],
  };

  const result = await service.updateFromJson(mixed);

  assert.equal(result.cities, 1);
  assert.equal(result.requestedCities, 2);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(
    result.skippedCities,
    ['Тестовая область / Нет в БД'],
  );
  assert.equal(pool.queries.at(-1), 'COMMIT');
});

test('population update rejects ambiguous name matching', async () => {
  const pool = createFakePool({
    statuses: [{
      regionName: 'Тестовая область',
      cityName: 'Тестоград',
      status: 'city-ambiguous',
    }],
    updatedCities: 0,
  });
  const service = createPopulationImportService(pool);

  await assert.rejects(
    service.updateFromJson(upload),
    /ambiguous/,
  );
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
});

test('streamed population import rolls back staged regions when JSON fails late', async () => {
  const regions = Array.from({ length: 101 }, (_value, index) => ({
    name: `Область ${index}`,
    attributes: {},
    cities: [{
      name: `Город ${index}`,
      population: 1000 + index,
      attributes: {},
    }],
  }));
  const malformed =
    '{"schemaVersion":2,"regions":' +
    JSON.stringify(regions) +
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
