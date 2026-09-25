import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GeometryEditorValidationError,
  geometryFamily,
  normalizeGeometryBulkUpdates,
  normalizeGeometryCreatePayload,
  normalizeGeometryTags,
  validateEditorGeometry,
} from '../src/modules/geometry/editor-policy.js';

test('geometry editor accepts supported geometry families', () => {
  const cases = [
    [{ type: 'Point', coordinates: [30, 60] }, 'point'],
    [{ type: 'LineString', coordinates: [[30, 60], [31, 61]] }, 'line'],
    [{ type: 'MultiLineString', coordinates: [[[30, 60], [31, 61]]] }, 'line'],
    [{ type: 'Polygon', coordinates: [[[30, 60], [31, 60], [31, 61], [30, 60]]] }, 'polygon'],
    [{ type: 'MultiPolygon', coordinates: [[[[30, 60], [31, 60], [31, 61], [30, 60]]]] }, 'polygon'],
  ];

  for (const [geometry, family] of cases) {
    assert.equal(
      geometryFamily(
        validateEditorGeometry(
          geometry,
        ),
      ),
      family,
    );
  }
});

test('geometry create payload validates line state and normalizes tags', () => {
  const value =
    normalizeGeometryCreatePayload({
      cityId: 4,
      geometry: {
        type: 'LineString',
        coordinates: [
          [30, 60],
          [31, 61],
        ],
      },
      lineTypeId: 7,
      lanes: 2,
      tags: [
        ' Центр ',
        'центр',
        'Обособленная',
      ],
      isVisible: false,
    });

  assert.equal(
    value.family,
    'line',
  );
  assert.equal(
    value.lineTypeId,
    7,
  );
  assert.equal(
    value.lanes,
    2,
  );
  assert.deepEqual(
    value.tags,
    [
      'Центр',
      'Обособленная',
    ],
  );
  assert.equal(
    value.isVisible,
    false,
  );

  assert.throws(
    () =>
      normalizeGeometryCreatePayload({
        cityId: 4,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [30, 60],
            [31, 60],
            [31, 61],
            [30, 60],
          ]],
        },
        lineTypeId: 7,
        lanes: 1,
      }),
    GeometryEditorValidationError,
  );
});

test('geometry tags remain case-insensitively unique', () => {
  assert.deepEqual(
    normalizeGeometryTags([
      'Трамвай',
      ' трамвай ',
      'Центр',
    ]),
    [
      'Трамвай',
      'Центр',
    ],
  );
});

test('geometry bulk updates require unique ids revisions and non-empty changes', () => {
  const updates =
    normalizeGeometryBulkUpdates({
      updates: [
        {
          id: 3,
          baseUpdatedAt:
            '2026-09-25T12:00:00Z',
          changes: {
            displayName:
              'Новая подпись',
          },
        },
      ],
    });

  assert.equal(
    updates[0].id,
    3,
  );
  assert.equal(
    updates[0].baseUpdatedAt,
    '2026-09-25T12:00:00.000Z',
  );

  assert.throws(
    () =>
      normalizeGeometryBulkUpdates({
        updates: [
          {
            id: 3,
            baseUpdatedAt:
              '2026-09-25T12:00:00Z',
            changes: {
              isVisible: true,
            },
          },
          {
            id: 3,
            baseUpdatedAt:
              '2026-09-25T12:00:00Z',
            changes: {
              isVisible: false,
            },
          },
        ],
      }),
    /Duplicate geometry id/u,
  );
});
