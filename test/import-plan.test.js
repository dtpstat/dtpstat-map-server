import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildImportPlan } from '../src/data/import-plan.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('repository data builds a complete and consistent import plan', async () => {
  const [csvText, geojsonText] = await Promise.all([
    fs.readFile(path.join(projectRoot, 'bus-lanes.csv'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'bus-lanes.geojson'), 'utf8'),
  ]);

  const plan = buildImportPlan(csvText, geojsonText);

  assert.equal(plan.cities.length, 71);
  assert.equal(plan.geometries.length, 872);
  assert.equal(plan.ignoredFeatures.length, 10);
  assert.equal(plan.cities[0].name, 'Казань');
  assert.equal(plan.populationPayload.populations.length, 71);
  assert.deepEqual(plan.populationPayload.populations[0], {
    name: 'Казань',
    population: 1257341,
    attributes: {},
  });
  assert.deepEqual(plan.cities[0].bounds, [
    48.892808, 55.7292851, 49.2362165, 55.8678227,
  ]);
  assert.equal(
    plan.geometries.filter((geometry) => geometry.cityName === 'Казань').length,
    46,
  );
});

test('import plan rejects population records for unknown cities', () => {
  const csv = [
    ',short_name,lanes_length,population,lanes_per_1K,minx,miny,maxx,maxy',
    '1,Другой город,20,1000,20,1,2,3,4',
  ].join('\n');
  const geojson = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          short_name: 'Тест',
          name: 'Тест',
          lanes: 1,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [1, 2],
            [3, 4],
          ],
        },
      },
    ],
  });

  assert.throws(
    () => buildImportPlan(csv, geojson),
    /No population found for city Тест/,
  );
});
