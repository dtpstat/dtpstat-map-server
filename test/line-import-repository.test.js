import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLineImportRepository,
} from '../src/modules/lines/import-repository.js';

function createClient() {
  const queries = [];
  return {
    queries,
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });
      if (
        normalized.startsWith('INSERT INTO line_transfer_raw') ||
        normalized.startsWith('WITH payload_rows AS')
      ) {
        return {
          rows: [],
          rowCount: values[0] ? JSON.parse(values[0]).length : 0,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

test('line import repository owns streaming staging SQL', async () => {
  const repository = createLineImportRepository();
  const client = createClient();
  const raw = [{ seq: 0, item: { type: 'Feature' } }];
  const normalized = [{
    seq: 0,
    cityName: 'Тестоград',
    citySlug: 'testograd',
    boundaryOsmType: null,
    boundaryOsmId: null,
    lineTypeName: 'default',
    lanes: 1,
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [[30, 60], [31, 61]],
    },
  }];

  await repository.createRawStage(client);
  const rawResult = await repository.insertRawBatch(client, raw);
  await repository.createNormalizedStage(client);
  const normalizedResult =
    await repository.insertNormalizedBatch(client, normalized);

  assert.equal(rawResult.rowCount, 1);
  assert.equal(normalizedResult.rowCount, 1);
  assert.match(
    client.queries[0].text,
    /^CREATE TEMP TABLE line_transfer_raw/u,
  );
  assert.match(
    client.queries[1].text,
    /^INSERT INTO line_transfer_raw/u,
  );
  assert.match(
    client.queries[2].text,
    /^CREATE TEMP TABLE line_transfer_stage/u,
  );
  assert.match(
    client.queries[3].text,
    /^WITH payload_rows AS/u,
  );
});

test('line import repository applies imported line type dictionary in replacement order', async () => {
  const repository = createLineImportRepository();
  const client = createClient();

  await repository.clearGeometries(client);
  await repository.applyLineTypeDictionary(client, [{
    code: 17,
    name: 'Трамвай',
    title: 'Трамвайные линии',
    color: '#cc4400',
    style: 'dashed',
    width: 6,
  }]);

  assert.equal(client.queries[0].text, 'DELETE FROM city_geometries');
  assert.match(client.queries[1].text, /DELETE FROM line_types AS line_type/u);
  assert.match(client.queries[2].text, /UPDATE line_types AS line_type/u);
  assert.match(client.queries[3].text, /INSERT INTO line_types/u);
});

test('line import repository selects streamed or materialized validation paths', async () => {
  const repository = createLineImportRepository();
  const client = createClient();
  const serialized = JSON.stringify([{
    boundaryOsmType: 'relation',
    boundaryOsmId: 1,
    lineTypeName: 'default',
  }]);

  await repository.findUnknownBoundaries(client);
  await repository.findUnknownBoundaries(client, serialized);
  await repository.findBoundaryCityConflicts(client);
  await repository.findBoundaryCityConflicts(client, serialized);
  await repository.findUnknownLineTypes(client);
  await repository.findUnknownLineTypes(client, serialized);

  assert.match(client.queries[0].text, /FROM line_transfer_stage AS stage/u);
  assert.match(client.queries[1].text, /jsonb_to_recordset/u);
  assert.match(client.queries[2].text, /FROM line_transfer_stage AS stage/u);
  assert.match(client.queries[3].text, /jsonb_to_recordset/u);
  assert.match(client.queries[4].text, /FROM line_transfer_stage AS stage/u);
  assert.match(client.queries[5].text, /jsonb_to_recordset/u);
});
