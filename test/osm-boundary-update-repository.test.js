import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOsmBoundaryUpdateRepository,
} from '../src/modules/osm/boundary-update-repository.js';
import { OsmCityGeometryError } from '../src/modules/osm/update-errors.js';

function createClient({
  invalidNames = [],
  stageCount = 2,
  insertedBoundaries = 2,
  restoredLinks = 1,
} = {}) {
  const queries = [];
  return {
    queries,
    async query(text, parameters = []) {
      const normalized = text.trim();
      queries.push({ text: normalized, parameters });
      if (normalized.startsWith('WITH payload_rows AS')) {
        return {
          rows: [],
          rowCount: JSON.parse(parameters[0]).length,
        };
      }
      if (normalized.startsWith('SELECT name')) {
        return {
          rows: invalidNames.map((name) => ({ name })),
          rowCount: invalidNames.length,
        };
      }
      if (normalized.startsWith('SELECT count(*)::integer')) {
        return {
          rows: [{ count: stageCount }],
          rowCount: 1,
        };
      }
      if (normalized.startsWith('INSERT INTO city_boundaries')) {
        return { rows: [], rowCount: insertedBoundaries };
      }
      if (normalized.startsWith('UPDATE city_geometries')) {
        return { rows: [], rowCount: restoredLinks };
      }
      if (normalized.startsWith('INSERT INTO osm_city_update_runs')) {
        return {
          rows: [{ id: 9, createdAt: '2026-09-23T12:00:00.000Z' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const places = [
  {
    name: 'Первый',
    placeType: 'city',
    adminLevel: null,
    osmType: 'relation',
    osmId: 1,
    tags: { name: 'Первый' },
    linework: {
      type: 'MultiLineString',
      coordinates: [[[30, 60], [31, 60], [30, 60]]],
    },
  },
  {
    name: 'Второй',
    placeType: 'town',
    adminLevel: null,
    osmType: 'way',
    osmId: 2,
    tags: { name: 'Второй' },
    linework: {
      type: 'MultiLineString',
      coordinates: [[[32, 60], [33, 60], [32, 60]]],
    },
  },
];

test('OSM boundary repository owns temp staging and validates staged geometry', async () => {
  const repository = createOsmBoundaryUpdateRepository();
  const client = createClient();

  await repository.dropStage(client);
  await repository.createStage(client);
  assert.equal(await repository.stageBatch(client, places, 4), 2);
  assert.equal(await repository.stageCount(client), 2);

  assert.equal(
    client.queries[0].text,
    'DROP TABLE IF EXISTS osm_city_boundary_stage',
  );
  assert.match(
    client.queries[1].text,
    /^CREATE TEMP TABLE osm_city_boundary_stage/u,
  );
  assert.match(client.queries[2].text, /^WITH payload_rows AS/u);
  assert.equal(
    JSON.parse(client.queries[2].parameters[0]).length,
    2,
  );
  assert.match(client.queries[3].text, /^SELECT name/u);
});

test('OSM boundary repository reports invalid staged polygons with their names', async () => {
  const repository = createOsmBoundaryUpdateRepository();
  const client = createClient({ invalidNames: ['Сломанная граница'] });

  await assert.rejects(
    repository.stageBatch(client, places, 2),
    (error) => {
      assert.ok(error instanceof OsmCityGeometryError);
      assert.match(error.message, /Сломанная граница/u);
      return true;
    },
  );
});

test('OSM boundary repository preserves replacement SQL boundaries', async () => {
  const repository = createOsmBoundaryUpdateRepository();
  const client = createClient();

  await repository.preserveLinks(client);
  await repository.deleteBoundaries(client);
  const inserted = await repository.insertBoundaries(
    client,
    '2026-09-23T10:00:00.000Z',
  );
  await repository.activateNewPlaces(client);
  const restored = await repository.restoreGeometryLinks(client);

  assert.equal(inserted.rowCount, 2);
  assert.equal(restored.rowCount, 1);
  assert.ok(client.queries.some(({ text }) =>
    text.startsWith('CREATE TEMP TABLE old_city_boundary_links')));
  assert.ok(client.queries.some(({ text }) =>
    text === 'DELETE FROM city_boundaries'));
  assert.ok(client.queries.some(({ text }) =>
    text.startsWith('INSERT INTO city_boundaries')));
  assert.ok(client.queries.some(({ text }) =>
    text.startsWith('WITH candidates AS')));
  assert.ok(client.queries.some(({ text }) =>
    text.startsWith('UPDATE city_geometries')));
});

test('OSM boundary repository records update-run metadata unchanged', async () => {
  const repository = createOsmBoundaryUpdateRepository();
  const client = createClient();
  const values = [
    'https://overpass-api.de/api/interpreter',
    'checksum',
    100,
    10,
    8,
    2,
    '2026-09-23T10:00:00.000Z',
    3,
    2,
    1,
    3,
    0,
    25,
    4,
  ];

  const result = await repository.insertRun(client, values);

  assert.equal(result.rows[0].id, 9);
  const query = client.queries.find(({ text }) =>
    text.startsWith('INSERT INTO osm_city_update_runs'));
  assert.deepEqual(query.parameters, values);
});
