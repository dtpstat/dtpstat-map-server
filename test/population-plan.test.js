import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPopulationPlan,
  PopulationValidationError,
} from '../src/data/population-plan.js';

function region(overrides = {}) {
  return {
    name: 'Тестовая область',
    attributes: { federalDistrict: 'Тестовый округ' },
    cities: [
      {
        name: 'Тестоград',
        population: 1300000,
        attributes: {},
      },
    ],
    ...overrides,
  };
}

test('population plan flattens region and city hierarchy', () => {
  const plan = buildPopulationPlan({
    schemaVersion: 2,
    asOf: '2026-01-01',
    source: '  Росстат  ',
    regions: [
      region({
        cities: [
          {
            name: 'Тестоград',
            population: '1300000',
            attributes: { year: 2026 },
          },
          {
            name: 'Второй город',
            population: null,
            asOf: '2025-01-01',
            source: 'Регионстат',
          },
        ],
      }),
    ],
  });

  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.regionCount, 1);
  assert.equal(plan.uniqueRegionCount, 1);
  assert.equal(plan.cityCount, 2);
  assert.equal(plan.encounteredCityCount, 2);
  assert.equal(plan.skippedCityCount, 0);
  assert.equal(plan.warnings.length, 0);
  assert.equal(plan.cities[0].regionName, 'Тестовая область');
  assert.equal(plan.cities[0].cityName, 'Тестоград');
  assert.equal(plan.cities[0].population, 1300000);
  assert.equal(plan.cities[0].asOf, '2026-01-01');
  assert.equal(plan.cities[0].source, 'Росстат');
  assert.deepEqual(plan.cities[0].attributes, { year: 2026 });
  assert.equal(plan.cities[1].population, null);
  assert.equal(plan.cities[1].asOf, '2025-01-01');
  assert.equal(plan.cities[1].source, 'Регионстат');
});

test('same city name is allowed in different regions', () => {
  const plan = buildPopulationPlan({
    schemaVersion: 2,
    regions: [
      region(),
      region({
        name: 'Другая область',
        cities: [{ name: 'Тестоград', population: 1000 }],
      }),
    ],
  });
  assert.equal(plan.cityCount, 2);
  assert.equal(plan.skippedCityCount, 0);
});

test('duplicate regions merge while invalid or duplicate cities become warnings', () => {
  const plan = buildPopulationPlan({
    schemaVersion: 2,
    regions: [
      region({
        cities: [
          { name: 'Первый', population: 1000 },
          { name: 'Плохой', population: 0 },
        ],
      }),
      region({
        name: '  тестовая ОБЛАСТЬ ',
        cities: [
          { name: 'Второй', population: 2000 },
          { name: 'Первый', population: 3000 },
        ],
      }),
    ],
  });

  assert.equal(plan.regionCount, 2);
  assert.equal(plan.uniqueRegionCount, 1);
  assert.equal(plan.encounteredCityCount, 4);
  assert.equal(plan.cityCount, 2);
  assert.equal(plan.skippedCityCount, 2);
  assert.deepEqual(
    plan.cities.map((city) => city.cityName),
    ['Первый', 'Второй'],
  );
  assert.ok(plan.warnings.some((item) =>
    item.code === 'duplicate-region-merged' && item.skipped === false));
  assert.ok(plan.warnings.some((item) =>
    item.code === 'invalid-city-data' && item.cityName === 'Плохой'));
  assert.ok(plan.warnings.some((item) =>
    item.code === 'duplicate-city' && item.cityName === 'Первый'));
});

test('invalid individual regions do not discard valid regions', () => {
  const plan = buildPopulationPlan({
    schemaVersion: 2,
    regions: [
      { name: '', cities: [{ name: 'Потерянный', population: 1000 }] },
      region(),
    ],
  });

  assert.equal(plan.regionCount, 2);
  assert.equal(plan.uniqueRegionCount, 1);
  assert.equal(plan.cityCount, 1);
  assert.equal(plan.encounteredCityCount, 2);
  assert.equal(plan.skippedCityCount, 1);
  assert.equal(plan.skippedRegionCount, 1);
  assert.ok(plan.warnings.some((item) =>
    item.code === 'invalid-region-name' && item.skipped));
});

test('document-level schema/date errors and empty hierarchy remain fatal', () => {
  assert.throws(
    () => buildPopulationPlan({
      schemaVersion: 1,
      regions: [region()],
    }),
    PopulationValidationError,
  );
  assert.throws(
    () => buildPopulationPlan({
      schemaVersion: 2,
      asOf: '2026-02-30',
      regions: [region()],
    }),
    PopulationValidationError,
  );
  assert.throws(
    () => buildPopulationPlan({
      schemaVersion: 2,
      regions: [],
    }),
    /non-empty regions array/,
  );
});
