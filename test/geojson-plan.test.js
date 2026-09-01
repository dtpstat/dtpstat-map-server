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

test('full repository GeoJSON derives cities and direction multipliers without city bounds', async () => {
  const source = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'bus-lanes.geojson'), 'utf8'),
  );
  const plan = buildGeoJsonPlan(source);
  assert.equal(plan.cities.length, 71);
  assert.equal(plan.geometries.length, 872);
  assert.equal(plan.ignoredFeatures.length, 10);
  assert.deepEqual(
    [...new Set(plan.geometries.map((geometry) => geometry.lanes))].sort(),
    [1, 2],
  );
  assert.equal(plan.cities.some((city) => 'bounds' in city), false);
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

function feature(cityName, lanes, start, end) {
  return {
    type: 'Feature',
    properties: {
      short_name: cityName,
      name: cityName,
      lanes,
    },
    geometry: {
      type: 'LineString',
      coordinates: [start, end],
    },
  };
}
