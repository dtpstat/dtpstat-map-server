import assert from 'node:assert/strict';
import test from 'node:test';
import { createCitiesRepository } from '../src/db/cities-repository.js';

test('city list qualifies ID after joining OSM boundaries', async () => {
  let sql;
  const repository = createCitiesRepository({
    async query(text) {
      sql = text;
      return { rows: [] };
    },
  });

  await repository.listCities();

  assert.match(sql, /city\.id::integer AS id/);
  assert.match(sql, /ST_PointOnSurface\(boundary\.geom\)/);
  assert.doesNotMatch(sql, /\n\s+id::integer AS id/);
});

test('viewport query selects intersecting lines without clipping and resolves center city', async () => {
  let sql;
  let values;
  const expected = {
    type: 'FeatureCollection',
    bbox: [37.4, 55.6, 37.9, 55.9],
    centerCityId: 7,
    features: [],
  };
  const repository = createCitiesRepository({
    async query(text, parameters) {
      sql = text;
      values = parameters;
      return { rows: [{ geojson: expected }] };
    },
  });

  const result = await repository.getViewportGeometries({
    west: 37.4,
    south: 55.6,
    east: 37.9,
    north: 55.9,
    centerLng: 37.62,
    centerLat: 55.75,
  });

  assert.equal(result, expected);
  assert.deepEqual(values, [37.4, 55.6, 37.9, 55.9, 37.62, 55.75]);
  assert.match(sql, /geometry\.geom && viewport\.geom/);
  assert.match(sql, /ST_Intersects\(geometry\.geom, viewport\.geom\)/);
  assert.match(sql, /geometry\.geom\s+FROM viewport/);
  assert.doesNotMatch(sql, /ST_Intersection\(geometry\.geom, viewport\.geom\)/);
  assert.match(sql, /line_type\.code AS line_type/);
  assert.match(sql, /'lineType', visible_geometries\.line_type/);
  assert.match(sql, /ST_Covers\(boundary\.geom, viewport\.center\)/);
});
