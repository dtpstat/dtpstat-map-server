import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPopulationPlan,
  PopulationValidationError,
} from '../src/data/population-plan.js';

test('population plan validates and normalizes an update batch', () => {
  const plan = buildPopulationPlan({
    asOf: '2026-01-01',
    source: '  Росстат  ',
    populations: [
      { name: ' Казань ', population: '1300000', attributes: { year: 2026 } },
    ],
  });

  assert.deepEqual(plan, {
    asOf: '2026-01-01',
    source: 'Росстат',
    populations: [
      {
        name: 'Казань',
        population: 1300000,
        attributes: { year: 2026 },
      },
    ],
  });
});

test('population plan rejects invalid dates, values, and duplicate cities', () => {
  assert.throws(
    () =>
      buildPopulationPlan({
        asOf: '2026-02-30',
        populations: [{ name: 'Казань', population: 1 }],
      }),
    PopulationValidationError,
  );
  assert.throws(
    () =>
      buildPopulationPlan({
        populations: [{ name: 'Казань', population: 0 }],
      }),
    /invalid population/,
  );
  assert.throws(
    () =>
      buildPopulationPlan({
        populations: [
          { name: 'Казань', population: 1 },
          { name: 'Казань', population: 2 },
        ],
      }),
    /Duplicate city/,
  );
});
