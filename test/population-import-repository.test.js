import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPopulationImportRepository,
} from '../src/modules/population/import-repository.js';

function createClient({ rowCountOverride = null } = {}) {
  const queries = [];
  const client = {
    queries,
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });
      if (normalized.startsWith('INSERT INTO population_transfer_raw')) {
        const rows = values[0] ? JSON.parse(values[0]) : [];
        return { rows: [], rowCount: rows.length };
      }
      if (normalized.startsWith('INSERT INTO population_transfer_stage')) {
        const rows = values[0] ? JSON.parse(values[0]) : [];
        return {
          rows: [],
          rowCount: rowCountOverride ?? rows.length,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return client;
}

test('population import repository owns raw and normalized staging SQL', async () => {
  const repository = createPopulationImportRepository();
  const client = createClient();

  await repository.createRawStage(client);
  const rawResult = await repository.insertRawBatch(client, [{
    seq: 0,
    item: { name: 'Регион' },
  }]);
  await repository.createStage(client);
  const staged = await repository.insertStageBatch(client, [{
    regionName: 'Регион',
    regionOsmType: null,
    regionOsmId: null,
    regionAttributes: {},
    cityName: 'Город',
    cityOsmType: null,
    cityOsmId: null,
    population: 1000,
    asOf: null,
    source: null,
    attributes: {},
  }], 7);

  assert.equal(rawResult.rowCount, 1);
  assert.equal(staged, 1);
  assert.match(
    client.queries[0].text,
    /^CREATE TEMP TABLE population_transfer_raw/u,
  );
  assert.match(
    client.queries[1].text,
    /^INSERT INTO population_transfer_raw/u,
  );
  assert.match(
    client.queries[2].text,
    /^CREATE TEMP TABLE population_transfer_stage/u,
  );
  assert.match(
    client.queries[3].text,
    /^INSERT INTO population_transfer_stage/u,
  );
  const payload = JSON.parse(client.queries[3].values[0]);
  assert.equal(payload[0].seq, 7);
});

test('population import repository keeps identity-first and name-fallback resolution SQL', async () => {
  const repository = createPopulationImportRepository();
  const client = createClient();

  await repository.resolveStage(client);

  const sql = client.queries[0].text;
  assert.match(sql, /^CREATE TEMP TABLE population_transfer_resolved/u);
  assert.match(sql, /boundary\.osm_type = stage_region\.region_osm_type/u);
  assert.match(sql, /boundary\.osm_type = stage\.city_osm_type/u);
  assert.match(sql, /application_city\.name/u);
  assert.match(sql, /application_city\.full_name/u);
  assert.match(sql, /boundary\.tags \? 'ISO3166-2'/u);
  assert.match(sql, /city-duplicate-target/u);
});

test('population import repository rejects partial normalized stage writes', async () => {
  const repository = createPopulationImportRepository();
  const client = createClient({ rowCountOverride: 0 });

  await assert.rejects(
    repository.insertStageBatch(client, [{
      regionName: 'Регион',
      regionAttributes: {},
      cityName: 'Город',
      population: 1000,
      attributes: {},
    }], 0),
    /Not every normalized population city was staged/u,
  );
});
