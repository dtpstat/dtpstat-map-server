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

test('legacy repository GeoJSON derives cities, multipliers, and default line type', async () => {
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
    [...new Set(plan.geometries.map((geometry) => geometry.lineType))],
    ['default'],
  );
  assert.equal(plan.cities.some((city) => 'bounds' in city), false);
});

test('versioned line GeoJSON carries line type styles and feature type links', () => {
  const collection = {
    type: 'FeatureCollection',
    schemaVersion: 2,
    lineTypes: [
      {
        type: 'default',
        name: 'Основные',
        color: '#045b69',
        style: 'solid',
        width: 4,
      },
      {
        type: 'tram',
        name: 'Трамвай',
        color: '#cc4400',
        style: 'dashed',
        width: 6,
      },
    ],
    features: [feature('Тест', 1, [30, 60], [30.1, 60.1], 'tram')],
  };

  const plan = buildGeoJsonPlan(collection);
  assert.equal(plan.geometries[0].lineType, 'tram');
  assert.deepEqual(plan.lineTypes[1], {
    type: 'tram',
    name: 'Трамвай',
    color: '#cc4400',
    style: 'dashed',
    width: 6,
  });
});

test('GeoJSON plan rejects direction multipliers other than one or two', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [
      feature('Тест', 3, [1, 2], [3, 4]),
    ],
  };

  assert.throws(
    () => buildGeoJsonPlan(collection),
    (error) =>
      error instanceof GeoJsonValidationError &&
      /lanes equal to 1 or 2/.test(error.message),
  );
});

function feature(cityName, lanes, start, end, lineType) {
  return {
    type: 'Feature',
    properties: {
      short_name: cityName,
      name: cityName,
      lanes,
      ...(lineType ? { _dtpstat: { lineType } } : {}),
    },
    geometry: {
      type: 'LineString',
      coordinates: [start, end],
    },
  };
}
