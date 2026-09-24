import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeOsmBoundaryChanges,
  normalizeOsmBoundaryId,
  normalizeOsmSubtreeActive,
  OsmBoundaryAdminValidationError,
} from '../src/modules/osm/boundary-admin-policy.js';

test('OSM boundary admin policy normalizes editable territory fields', () => {
  const normalized = normalizeOsmBoundaryChanges({
    active: false,
    displayName: '  Тестоград  ',
    displayType: ' city ',
    population: '125000',
    populationAsOf: '2026-02-01',
    populationSource: ' Регионстат ',
    attributes: { census: true },
  });

  assert.deepEqual(normalized, {
    active: false,
    displayName: 'Тестоград',
    displayType: 'city',
    population: 125000,
    populationAsOf: '2026-02-01',
    populationSource: 'Регионстат',
    attributes: { census: true },
  });
});

test('OSM boundary admin policy validates ids subtree state and population before DB work', () => {
  assert.equal(normalizeOsmBoundaryId('42'), 42);
  assert.equal(normalizeOsmSubtreeActive(true), true);

  assert.throws(
    () => normalizeOsmBoundaryId(0),
    OsmBoundaryAdminValidationError,
  );
  assert.throws(
    () => normalizeOsmSubtreeActive('false'),
    /active must be boolean/u,
  );
  assert.throws(
    () => normalizeOsmBoundaryChanges({
      population: -1,
    }),
    /population must be a positive integer/u,
  );
  assert.throws(
    () => normalizeOsmBoundaryChanges({
      populationAsOf: '2026-02-30',
    }),
    /valid calendar date/u,
  );
});

test('OSM boundary admin policy rejects unsupported and empty updates', () => {
  assert.throws(
    () => normalizeOsmBoundaryChanges({
      parentId: 7,
    }),
    /Unsupported OSM boundary fields/u,
  );
  assert.throws(
    () => normalizeOsmBoundaryChanges({}),
    /No OSM boundary changes supplied/u,
  );
});
