import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPopulationPlan,
  PopulationValidationError,
} from '../src/data/population-plan.js';

function territory(overrides = {}) {
  return {
    osmType: 'relation',
    osmId: '123',
    name: 'Тестовая область',
    type: 'administrative',
    placeType: null,
    adminLevel: 4,
    population: 2000000,
    attributes: {},
    children: [],
    ...overrides,
  };
}

test('population plan flattens a hierarchical territory snapshot', () => {
  const plan = buildPopulationPlan({
    schemaVersion: 2,
    asOf: '2026-01-01',
    source: '  Росстат  ',
    territories: [
      territory({
        children: [
          territory({
            osmId: '456',
            name: 'Тестоград',
            type: 'city',
            placeType: 'city',
            adminLevel: 6,
            population: '1300000',
            attributes: { year: 2026 },
          }),
        ],
      }),
    ],
  });

  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.rootCount, 1);
  assert.equal(plan.territoryCount, 2);
  assert.equal(plan.territories[0].osmId, '123');
  assert.equal(plan.territories[0].parentOsmId, null);
  assert.equal(plan.territories[1].osmId, '456');
  assert.equal(plan.territories[1].parentOsmType, 'relation');
  assert.equal(plan.territories[1].parentOsmId, '123');
  assert.equal(plan.territories[1].population, 1300000);
  assert.equal(plan.territories[1].asOf, '2026-01-01');
  assert.equal(plan.territories[1].source, 'Росстат');
  assert.deepEqual(plan.territories[1].attributes, { year: 2026 });
});

test('population plan preserves per-territory source/date and null population', () => {
  const plan = buildPopulationPlan({
    schemaVersion: 2,
    territories: [
      territory({
        population: null,
        asOf: '2025-01-01',
        source: 'Региональная статистика',
      }),
    ],
  });

  assert.equal(plan.territories[0].population, null);
  assert.equal(plan.territories[0].asOf, '2025-01-01');
  assert.equal(plan.territories[0].source, 'Региональная статистика');
});

test('population plan rejects invalid schema, values and duplicate OSM identity', () => {
  assert.throws(
    () => buildPopulationPlan({
      schemaVersion: 1,
      territories: [territory()],
    }),
    PopulationValidationError,
  );
  assert.throws(
    () => buildPopulationPlan({
      schemaVersion: 2,
      asOf: '2026-02-30',
      territories: [territory()],
    }),
    PopulationValidationError,
  );
  assert.throws(
    () => buildPopulationPlan({
      schemaVersion: 2,
      territories: [territory({ population: 0 })],
    }),
    /positive integer/,
  );
  assert.throws(
    () => buildPopulationPlan({
      schemaVersion: 2,
      territories: [
        territory(),
        territory({ name: 'Другое имя' }),
      ],
    }),
    /Duplicate OSM territory identity/,
  );
});
