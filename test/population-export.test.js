import assert from 'node:assert/strict';
import test from 'node:test';
import { createDataExportRepository } from '../src/db/data-export-repository.js';

const rows = [
  {
    regionId: 10,
    regionName: 'Первая область',
    regionAttributes: { federalDistrict: 'Округ' },
    cityId: 1,
    cityName: 'Первый город',
    population: 100000,
    asOf: '2026-01-01',
    source: 'test',
    attributes: {},
  },
  {
    regionId: 10,
    regionName: 'Первая область',
    regionAttributes: { federalDistrict: 'Округ' },
    cityId: 2,
    cityName: 'Второй город',
    population: null,
    asOf: null,
    source: null,
    attributes: { note: 'x' },
  },
  {
    regionId: 20,
    regionName: 'Вторая область',
    regionAttributes: {},
    cityId: 3,
    cityName: 'Третий город',
    population: 300000,
    asOf: '2025-01-01',
    source: 'regional',
    attributes: {},
  },
];

test('population export groups named cities by region', async () => {
  const database = {
    async query(text) {
      if (text.includes('SELECT now() AS "exportedAt"')) {
        return { rows: [{ exportedAt: '2026-09-22T12:00:00.000Z' }] };
      }
      if (text.includes('WITH RECURSIVE ancestry AS')) {
        return { rows };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };

  const repository = createDataExportRepository(database);
  const payload = await repository.exportPopulations();

  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.regions.length, 2);
  assert.equal(payload.regions[0].name, 'Первая область');
  assert.deepEqual(
    payload.regions[0].attributes,
    { federalDistrict: 'Округ' },
  );
  assert.equal(payload.regions[0].cities.length, 2);
  assert.equal(payload.regions[0].cities[0].name, 'Первый город');
  assert.equal(payload.regions[0].cities[0].population, 100000);
  assert.equal(payload.regions[1].cities[0].name, 'Третий город');
  assert.equal('osmId' in payload.regions[0], false);
  assert.equal('osmType' in payload.regions[0], false);
});

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test('streaming population export emits the same region-city shape', async () => {
  let fetchCount = 0;
  const client = {
    async query(text) {
      const normalized = text.trim();
      if (normalized === 'BEGIN READ ONLY') return { rows: [] };
      if (normalized === 'SELECT now() AS "exportedAt"') {
        return { rows: [{ exportedAt: '2026-09-22T12:00:00.000Z' }] };
      }
      if (normalized.startsWith('DECLARE portable_population_export')) {
        return { rows: [] };
      }
      if (normalized.startsWith('FETCH FORWARD')) {
        fetchCount += 1;
        return fetchCount === 1 ? { rows } : { rows: [] };
      }
      if (
        normalized === 'CLOSE portable_population_export' ||
        normalized === 'ROLLBACK'
      ) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
    release() {},
  };
  const database = {
    async connect() { return client; },
  };

  const repository = createDataExportRepository(database);
  const payload = JSON.parse(await collect(repository.streamPopulations()));

  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.regions.length, 2);
  assert.equal(payload.regions[0].name, 'Первая область');
  assert.equal(payload.regions[0].cities[1].name, 'Второй город');
  assert.equal(payload.regions[0].cities[1].population, null);
  assert.equal(payload.regions[1].name, 'Вторая область');
  assert.equal(payload.regions[1].cities[0].population, 300000);
});
