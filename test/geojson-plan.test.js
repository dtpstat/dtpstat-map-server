import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildGeoJsonPlan,
  GeoJsonValidationError,
} from '../src/data/geojson-plan.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('legacy repository GeoJSON derives cities, multipliers, and default imported type name', async () => {
  const source = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'bus-lanes.geojson'), 'utf8'),
  );
  const plan = buildGeoJsonPlan(source);
  assert.equal(plan.cities.length, 71);
  assert.equal(plan.geometries.length, 872);
  assert.equal(plan.ignoredFeatures.length, 10);
  assert.equal(plan.lineTypes.length, 0);
  assert.deepEqual(
    [...new Set(plan.geometries.map((geometry) => geometry.lanes))].sort(),
    [1, 2],
  );
  assert.deepEqual(
    [...new Set(plan.geometries.map((geometry) => geometry.lineTypeName))],
    ['default'],
  );
  assert.equal(plan.cities.some((city) => 'bounds' in city), false);
});

test('versioned line GeoJSON resolves numeric business code through dictionary name and strips transport metadata', () => {
  const collection = {
    type: 'FeatureCollection',
    schemaVersion: 3,
    lineTypes: [
      {
        code: 0,
        name: 'default',
        title: 'Основные',
        color: '#045b69',
        style: 'solid',
        width: 4,
      },
      {
        code: 7,
        name: 'Трамвай',
        title: 'Трамвайные линии',
        color: '#cc4400',
        style: 'dashed',
        width: 6,
      },
    ],
    features: [feature('Тест', 1, [30, 60], [30.1, 60.1], 7)],
  };

  const plan = buildGeoJsonPlan(collection);
  assert.equal(plan.geometries[0].lineTypeName, 'Трамвай');
  assert.equal(plan.geometries[0].properties._dtpstat, undefined);
  assert.equal(plan.geometries[0].properties.businessTypeCode, undefined);
  assert.deepEqual(plan.lineTypes[1], {
    code: 7,
    name: 'Трамвай',
    title: 'Трамвайные линии',
    color: '#cc4400',
    style: 'dashed',
    width: 6,
  });
});

test('legacy schemaVersion 2 string type becomes imported NAME and old name becomes TITLE', () => {
  const collection = {
    type: 'FeatureCollection',
    schemaVersion: 2,
    lineTypes: [
      { type: 'one-way', name: 'Односторонние', color: '#cc4400', style: 'solid', width: 4 },
    ],
    features: [legacyFeature('Тест', 1, [30, 60], [30.1, 60.1], 'one-way')],
  };

  const plan = buildGeoJsonPlan(collection);
  assert.equal(plan.lineTypes[0].name, 'one-way');
  assert.equal(plan.lineTypes[0].title, 'Односторонние');
  assert.equal(plan.geometries[0].lineTypeName, 'one-way');
});

test('GeoJSON plan rejects numeric business code outside the dictionary before DB work', () => {
  const collection = {
    type: 'FeatureCollection',
    schemaVersion: 3,
    lineTypes: [
      { code: 0, name: 'default', title: 'Основные', color: '#045b69', style: 'solid', width: 4 },
    ],
    features: [feature('Тест', 1, [1, 2], [3, 4], 99)],
  };

  assert.throws(() => buildGeoJsonPlan(collection), /unknown business type code: 99/);
});

test('GeoJSON plan rejects direction multipliers other than one or two', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [feature('Тест', 3, [1, 2], [3, 4])],
  };
  assert.throws(
    () => buildGeoJsonPlan(collection),
    (error) =>
      error instanceof GeoJsonValidationError &&
      /lanes equal to 1 or 2/.test(error.message),
  );
});

function feature(cityName, lanes, start, end, businessTypeCode) {
  return {
    type: 'Feature',
    properties: {
      short_name: cityName,
      name: cityName,
      lanes,
      ...(businessTypeCode === undefined
        ? {}
        : { _dtpstat: { businessTypeCode } }),
    },
    geometry: { type: 'LineString', coordinates: [start, end] },
  };
}

function legacyFeature(cityName, lanes, start, end, lineType) {
  return {
    type: 'Feature',
    properties: {
      short_name: cityName,
      name: cityName,
      lanes,
      _dtpstat: { lineType },
    },
    geometry: { type: 'LineString', coordinates: [start, end] },
  };
}
