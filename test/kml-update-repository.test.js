import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKmlUpdateRepository,
} from '../src/modules/lines/kml-update-repository.js';

function createClient() {
  const queries = [];
  return {
    queries,
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });
      if (
        normalized.startsWith('WITH requested AS') &&
        normalized.includes('requested.name AS "requestedName"')
      ) {
        return {
          rows: [{
            requestedName: 'default',
            id: 1,
            code: 0,
            name: 'default',
          }],
          rowCount: 1,
        };
      }
      if (
        normalized.startsWith('WITH requested AS') &&
        normalized.includes('INSERT INTO line_types')
      ) {
        return { rows: [{ id: 2, code: 1, name: 'new' }], rowCount: 1 };
      }
      if (normalized.startsWith('SELECT EXISTS')) {
        return { rows: [{ ready: true }], rowCount: 1 };
      }
      if (normalized.includes('LEFT JOIN LATERAL')) {
        return {
          rows: [{
            inputIndex: 0,
            boundaryId: '11',
            cityId: '1',
            cityName: 'City',
            placeName: 'City',
            candidateCount: 1,
          }],
          rowCount: 1,
        };
      }
      if (normalized.includes('INSERT INTO city_geometries')) {
        const rows = JSON.parse(values[0]);
        return { rows: [], rowCount: rows.length };
      }
      if (normalized.startsWith('INSERT INTO geometry_update_runs')) {
        return {
          rows: [{ id: 7, createdAt: '2026-09-23T12:00:00.000Z' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

test('KML repository owns line type and boundary match SQL', async () => {
  const repository = createKmlUpdateRepository();
  const client = createClient();

  const lineTypes = await repository.loadLineTypes(client, ['default']);
  const created = await repository.insertMissingLineTypes(client, ['new']);
  const ready = await repository.boundariesReady(client);
  await repository.prepareMatchGeometries(client, 250);

  assert.equal(lineTypes.rows[0].code, 0);
  assert.equal(created.rows[0].code, 1);
  assert.equal(ready.rows[0].ready, true);
  assert.match(client.queries[0].text, /requested.name AS "requestedName"/u);
  assert.match(client.queries[1].text, /INSERT INTO line_types/u);
  assert.match(client.queries[2].text, /^SELECT EXISTS/u);
  assert.match(
    client.queries[3].text,
    /^CREATE TEMP TABLE kml_place_match_geometries/u,
  );
  assert.equal(client.queries[3].values[0], 250);
  assert.match(
    client.queries[4].text,
    /^CREATE INDEX kml_place_match_geometries_geom_idx/u,
  );
});

test('KML repository serializes match and geometry payloads', async () => {
  const repository = createKmlUpdateRepository();
  const client = createClient();

  const matchPayload = [{
    inputIndex: 0,
    geometry: {
      type: 'LineString',
      coordinates: [[1, 1], [2, 2]],
    },
  }];
  const matched = [{
    cityId: 1,
    boundaryId: 11,
    lineTypeId: 1,
    multiple: 2,
    properties: {},
    geometry: matchPayload[0].geometry,
  }];

  const match = await repository.matchGeometries(client, matchPayload);
  const insert = await repository.insertGeometries(client, matched);

  assert.equal(match.rows[0].boundaryId, '11');
  assert.equal(insert.rowCount, 1);
  assert.deepEqual(JSON.parse(client.queries[0].values[0]), matchPayload);
  assert.deepEqual(JSON.parse(client.queries[1].values[0]), matched);
  assert.match(client.queries[0].text, /LEFT JOIN LATERAL/u);
  assert.match(client.queries[1].text, /INSERT INTO city_geometries/u);
});

test('KML repository owns city materialization and update-run persistence', async () => {
  const repository = createKmlUpdateRepository();
  const client = createClient();
  const payload = [{ cityName: 'City', boundaryId: '11' }];

  await repository.upsertMatchedCities(client, payload);
  await repository.linkMatchedCities(client, payload);
  await repository.loadMatchedCityIds(client, payload);
  await repository.clearGeometries(client);
  const run = await repository.insertUpdateRun(client, [
    '[]',
    'checksum',
    6,
    1,
    1,
    0,
    0,
    0,
    0,
  ]);

  assert.match(client.queries[0].text, /INSERT INTO cities/u);
  assert.match(client.queries[1].text, /UPDATE city_boundaries AS boundary/u);
  assert.match(client.queries[2].text, /boundary.id::integer AS "boundaryId"/u);
  assert.equal(client.queries[3].text, 'DELETE FROM city_geometries');
  assert.match(client.queries[4].text, /^INSERT INTO geometry_update_runs/u);
  assert.equal(run.rows[0].id, 7);
});
