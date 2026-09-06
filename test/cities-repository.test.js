import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCitiesRepository,
  expandViewportBounds,
  VIEWPORT_EXPANSION_RATIO,
} from '../src/db/cities-repository.js';

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

test('viewport selector is twenty percent larger overall and clamps WGS84 bounds', () => {
  assert.equal(VIEWPORT_EXPANSION_RATIO, 0.2);
  const expanded = expandViewportBounds({
    west: 10,
    south: 20,
    east: 20,
    north: 30,
  });
  assert.deepEqual(expanded, {
    west: 9,
    south: 19,
    east: 21,
    north: 31,
  });

  assert.deepEqual(expandViewportBounds({
    west: -179,
    south: -89,
    east: 179,
    north: 89,
  }), {
    west: -180,
    south: -90,
    east: 180,
    north: 90,
  });
});

test('viewport query uses padded selector, returns complete intersecting lines and numeric type code', async () => {
  let sql;
  let values;
  const expected = {
    type: 'FeatureCollection',
    bbox: [37.35, 55.57, 37.95, 55.93],
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
  assert.ok(Math.abs(values[0] - 37.35) < 1e-9);
  assert.ok(Math.abs(values[1] - 55.57) < 1e-9);
  assert.ok(Math.abs(values[2] - 37.95) < 1e-9);
  assert.ok(Math.abs(values[3] - 55.93) < 1e-9);
  assert.deepEqual(values.slice(4), [37.62, 55.75]);
  assert.match(sql, /geometry\.geom && viewport\.geom/);
  assert.match(sql, /ST_Intersects\(geometry\.geom, viewport\.geom\)/);
  assert.match(sql, /geometry\.geom\s+FROM viewport/);
  assert.doesNotMatch(sql, /ST_Intersection\(geometry\.geom, viewport\.geom\)/);
  assert.match(sql, /line_type\.code AS business_type_code/);
  assert.match(sql, /'businessTypeCode', visible_geometries\.business_type_code/);
  assert.match(sql, /ST_Covers\(boundary\.geom, viewport\.center\)/);
});
