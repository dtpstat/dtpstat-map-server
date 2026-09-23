import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCityBoundaryGeoJsonPlan,
  CityBoundaryGeoJsonValidationError,
} from '../src/data/city-boundary-geojson-plan.js';

function collection(properties = {}) {
  return {
    type: 'FeatureCollection',
    schemaVersion: 1,
    features: [{
      type: 'Feature',
      properties: {
        placeType: 'city',
        osmType: 'relation',
        osmId: 12345,
        osmName: 'Тестоград',
        tags: { place: 'city', name: 'Тестоград' },
        osmTimestamp: '2026-09-01T12:00:00Z',
        updatedAt: '2026-09-01T13:00:00Z',
        citySlug: 'testograd',
        cityName: 'Тестоград',
        city: {
          slug: 'testograd',
          name: 'Тестоград',
          fullName: 'Город Тестоград',
          attributes: { source: 'transfer-test' },
        },
        ...properties,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [30, 60],
          [30.1, 60],
          [30.1, 60.1],
          [30, 60],
        ]],
      },
    }],
  };
}

test('city boundary transfer plan preserves OSM and linked city properties', () => {
  const source = collection();
  const plan = buildCityBoundaryGeoJsonPlan(source);
  assert.deepEqual(plan.boundaries, [{
    placeType: 'city',
    adminLevel: null,
    active: true,
    displayName: 'Тестоград',
    displayType: 'city',
    osmType: 'relation',
    osmId: 12345,
    osmName: 'Тестоград',
    tags: { place: 'city', name: 'Тестоград' },
    osmTimestamp: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T13:00:00.000Z',
    population: null,
    populationAsOf: null,
    populationSource: null,
    attributes: {},
    citySlug: 'testograd',
    cityName: 'Тестоград',
    geometry: source.features[0].geometry,
  }]);
  assert.deepEqual(plan.cities, [{
    slug: 'testograd',
    name: 'Тестоград',
    fullName: 'Город Тестоград',
    displayType: 'city',
    attributes: { source: 'transfer-test' },
  }]);
});

test('city boundary transfer plan rejects duplicate OSM objects', () => {
  const source = collection();
  source.features.push(structuredClone(source.features[0]));
  assert.throws(
    () => buildCityBoundaryGeoJsonPlan(source),
    /duplicate OSM object relation\/12345/,
  );
});

test('city boundary transfer plan rejects invalid place metadata', () => {
  assert.throws(
    () => buildCityBoundaryGeoJsonPlan(collection({ placeType: 'village' })),
    CityBoundaryGeoJsonValidationError,
  );
});


test('city boundary transfer accepts administrative geometry without place tag', () => {
  const source = collection({
    placeType: null,
    adminLevel: 4,
    active: false,
    displayName: 'Тестовая область',
    displayType: 'administrative',
  });
  delete source.features[0].properties.tags.place;
  source.features[0].properties.tags.boundary = 'administrative';
  source.features[0].properties.tags.admin_level = '4';

  const plan = buildCityBoundaryGeoJsonPlan(source);
  assert.equal(plan.boundaries[0].placeType, null);
  assert.equal(plan.boundaries[0].adminLevel, 4);
  assert.equal(plan.boundaries[0].active, false);
  assert.equal(plan.boundaries[0].displayName, 'Тестовая область');
  assert.equal(plan.boundaries[0].displayType, 'administrative');
});
