import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCityBoundaryTransferRepository,
} from '../src/modules/geometry/city-boundary-transfer-repository.js';

function createClient() {
  const queries = [];
  return {
    queries,
    async query(text, values = []) {
      const normalized = text.trim();
      queries.push({ text: normalized, values });
      if (normalized.startsWith('INSERT INTO cities')) {
        return {
          rows: [],
          rowCount: values[0] ? JSON.parse(values[0]).length : 0,
        };
      }
      if (normalized.startsWith('WITH payload_rows AS')) {
        return {
          rows: [],
          rowCount: values[0] ? JSON.parse(values[0]).length : 0,
        };
      }
      if (normalized.startsWith('INSERT INTO city_boundaries')) {
        return { rows: [], rowCount: 2 };
      }
      if (normalized.startsWith('UPDATE city_geometries')) {
        return { rows: [], rowCount: 3 };
      }
      if (normalized.startsWith('SELECT count(*)::integer')) {
        return { rows: [{ count: 2 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

test('city boundary transfer repository owns bounded PostGIS staging', async () => {
  const repository = createCityBoundaryTransferRepository();
  const client = createClient();
  const batch = [
    {
      placeType: 'city',
      adminLevel: null,
      active: true,
      displayName: 'A',
      displayType: 'city',
      osmType: 'relation',
      osmId: 1,
      osmName: 'A',
      tags: {},
      osmTimestamp: null,
      updatedAt: null,
      population: null,
      populationAsOf: null,
      populationSource: null,
      attributes: {},
      citySlug: null,
      cityName: null,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[[
          [30, 60],
          [31, 60],
          [30, 60],
        ]]],
      },
    },
  ];

  await repository.createStage(client);
  const inserted = await repository.insertStageBatch(client, batch);

  assert.equal(inserted.rowCount, 1);
  assert.match(
    client.queries[0].text,
    /^CREATE TEMP TABLE city_boundary_transfer_stage/u,
  );
  assert.match(client.queries[1].text, /^WITH payload_rows AS/u);
  assert.match(
    client.queries[1].text,
    /ST_Area\(prepared\.geom::geography\) AS area_m2/u,
  );
  assert.match(
    client.queries[1].text,
    /ST_Envelope\(geom\)/u,
  );
});

test('city boundary transfer repository preserves exact OSM geometry links', async () => {
  const repository = createCityBoundaryTransferRepository();
  const client = createClient();

  await repository.preserveGeometryLinks(client);
  await repository.deleteBoundaries(client);
  const inserted = await repository.insertBoundaries(client);
  const restored = await repository.restoreGeometryLinks(client);

  assert.equal(inserted.rowCount, 2);
  assert.equal(restored.rowCount, 3);
  assert.match(
    client.queries[0].text,
    /^CREATE TEMP TABLE old_transfer_geometry_links/u,
  );
  assert.equal(client.queries[1].text, 'DELETE FROM city_boundaries');
  assert.match(
    client.queries[2].text,
    /^INSERT INTO city_boundaries/u,
  );
  assert.match(
    client.queries[2].text,
    /SELECT MIN\(city\.id\)[\s\S]*HAVING COUNT\(\*\) = 1/u,
  );
  assert.match(
    client.queries[3].text,
    /^UPDATE city_geometries/u,
  );
});

test('city boundary transfer repository upserts linked cities and counts links', async () => {
  const repository = createCityBoundaryTransferRepository();
  const client = createClient();
  const cities = [{
    slug: 'test',
    name: 'Test',
    fullName: 'Test City',
    displayType: 'city',
    attributes: {},
  }];

  const cityResult = await repository.upsertCities(client, cities);
  const linkedResult = await repository.linkedCityCount(client);

  assert.equal(cityResult.rowCount, 1);
  assert.equal(linkedResult.rows[0].count, 2);
  assert.match(client.queries[0].text, /^INSERT INTO cities/u);
  assert.match(
    client.queries[1].text,
    /WHERE city_id IS NOT NULL/u,
  );
});
