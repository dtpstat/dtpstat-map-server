import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GeometryImportSessionError,
  normalizeGeometryImportDecisions,
  normalizeGeometryImportSessionId,
} from '../src/modules/geometry/import-policy.js';

test('geometry import session ids are positive integers', () => {
  assert.equal(
    normalizeGeometryImportSessionId(
      '17',
    ),
    17,
  );

  assert.throws(
    () =>
      normalizeGeometryImportSessionId(
        '0',
      ),
    GeometryImportSessionError,
  );
});

test('geometry import decisions normalize keep add and replace actions', () => {
  const decisions =
    normalizeGeometryImportDecisions([
      {
        incomingId: 4,
        action:
          'keep-existing',
      },
      {
        incomingId: 5,
        action:
          'add-new',
      },
      {
        incomingId: 6,
        action:
          'replace',
        replaceExistingIds: [
          12,
          13,
          12,
        ],
      },
    ]);

  assert.deepEqual(
    decisions.get(4),
    {
      incomingId: 4,
      action:
        'keep-existing',
      replaceExistingIds: [],
    },
  );
  assert.deepEqual(
    decisions.get(5),
    {
      incomingId: 5,
      action:
        'add-new',
      replaceExistingIds: [],
    },
  );
  assert.deepEqual(
    decisions.get(6),
    {
      incomingId: 6,
      action:
        'replace',
      replaceExistingIds: [
        12,
        13,
      ],
    },
  );
});

test('geometry import decisions reject duplicates and invalid replace targets', () => {
  assert.throws(
    () =>
      normalizeGeometryImportDecisions([
        {
          incomingId: 4,
          action:
            'keep-existing',
        },
        {
          incomingId: 4,
          action:
            'add-new',
        },
      ]),
    /Duplicate decision/u,
  );

  assert.throws(
    () =>
      normalizeGeometryImportDecisions([
        {
          incomingId: 4,
          action:
            'replace',
          replaceExistingIds: [],
        },
      ]),
    /replaceExistingIds/u,
  );
});
