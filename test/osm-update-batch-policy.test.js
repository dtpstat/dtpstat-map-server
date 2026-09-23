import assert from 'node:assert/strict';
import test from 'node:test';
import { OsmCityUpdateValidationError } from '../src/data/osm-city-update-options.js';
import {
  addNameCounts,
  assertCompleteBatch,
  combineIndexParts,
  createObjectBatches,
  objectKey,
} from '../src/modules/osm/update-batch-policy.js';
import { OsmCityGeometryError } from '../src/modules/osm/update-errors.js';

test('OSM batch policy builds stable object keys and fixed-size batches', () => {
  const objects = [
    { osmType: 'relation', osmId: 1 },
    { osmType: 'way', osmId: 2 },
    { osmType: 'way', osmId: 3 },
  ];
  assert.equal(objectKey(objects[0]), 'relation/1');
  assert.deepEqual(createObjectBatches(objects, 2), [
    objects.slice(0, 2),
    objects.slice(2),
  ]);
});

test('OSM batch policy rejects incomplete or unexpected geometry responses', () => {
  const expected = [
    { osmType: 'relation', osmId: 1 },
    { osmType: 'way', osmId: 2 },
  ];
  assert.doesNotThrow(() => assertCompleteBatch(expected, [
    { osmType: 'way', osmId: 2 },
    { osmType: 'relation', osmId: 1 },
  ], 4));

  assert.throws(
    () => assertCompleteBatch(expected, [
      { osmType: 'relation', osmId: 1 },
      { osmType: 'way', osmId: 9 },
    ], 4),
    (error) => {
      assert.ok(error instanceof OsmCityGeometryError);
      assert.match(error.message, /batch 4/u);
      assert.match(error.message, /missing: way\/2/u);
      assert.match(error.message, /unexpected: way\/9/u);
      return true;
    },
  );
});

test('OSM batch policy combines index parts deterministically', () => {
  const result = combineIndexParts([
    {
      objects: [
        { osmType: 'way', osmId: 20 },
        { osmType: 'relation', osmId: 10 },
      ],
      sourceElements: 2,
      osmTimestamp: '2026-09-23T12:00:00.000Z',
    },
    {
      objects: [
        { osmType: 'relation', osmId: 10 },
        { osmType: 'way', osmId: 30 },
      ],
      sourceElements: 2,
      osmTimestamp: '2026-09-23T11:00:00.000Z',
    },
  ]);

  assert.deepEqual(result.objects, [
    { osmType: 'relation', osmId: 10 },
    { osmType: 'way', osmId: 20 },
    { osmType: 'way', osmId: 30 },
  ]);
  assert.equal(result.sourceElements, 4);
  assert.equal(result.duplicateIndexObjects, 1);
  assert.equal(result.osmTimestamp, '2026-09-23T11:00:00.000Z');
});

test('OSM batch policy rejects an empty effective index', () => {
  assert.throws(
    () => combineIndexParts([
      { objects: [], sourceElements: 0, osmTimestamp: null },
    ]),
    OsmCityUpdateValidationError,
  );
});

test('OSM batch policy accumulates duplicate display-name counts', () => {
  const counts = new Map();
  addNameCounts(counts, [
    { name: 'А' },
    { name: 'Б' },
    { name: 'А' },
  ]);
  assert.equal(counts.get('А'), 2);
  assert.equal(counts.get('Б'), 1);
});
