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

test('full repository GeoJSON derives cities, bounds, and statistics', async () => {
  const source = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'bus-lanes.geojson'), 'utf8'),
  );
  const plan = buildGeoJsonPlan(source);
  const kazan = plan.cities.find((city) => city.name === 'Казань');

  assert.equal(plan.cities.length, 71);
  assert.equal(plan.geometries.length, 872);
  assert.equal(plan.ignoredFeatures.length, 10);
  assert.equal(kazan.population, 1257341);
  assert.ok(Math.abs(kazan.laneLengthMeters - 182706.9706255249) < 0.001);
  assert.deepEqual(kazan.bounds, [
    48.892808, 55.7292851, 49.2362165, 55.8678227,
  ]);
});

test('GeoJSON plan rejects inconsistent population before database writes', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [
      feature('Тест', 1000, [1, 2], [3, 4]),
      feature('Тест', 2000, [3, 4], [5, 6]),
    ],
  };

  assert.throws(
    () => buildGeoJsonPlan(collection),
    (error) =>
      error instanceof GeoJsonValidationError &&
      /Population is inconsistent/.test(error.message),
  );
});

function feature(cityName, population, start, end) {
  return {
    type: 'Feature',
    properties: {
      short_name: cityName,
      name: cityName,
      population,
      lanes: 1,
      length: 100,
      lanes_length: 100,
    },
    geometry: {
      type: 'LineString',
      coordinates: [start, end],
    },
  };
}
