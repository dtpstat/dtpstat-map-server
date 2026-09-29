import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GeometryEditorValidationError,
  geometryFamily,
  normalizeGeometryBulkUpdates,
  normalizeGeometryCreatePayload,
  normalizeGeometryMergeRequest,
  normalizeGeometryTags,
  validateEditorGeometry,
} from '../src/modules/geometry/editor-policy.js';
import {
  normalizeGeometryCutRequest,
  normalizeGeometrySplitRequest,
} from '../src/modules/geometry/topology-policy.js';

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

test('point geometry accepts an optional point type and other families reject it', () => {
  const point =
    normalizeGeometryCreatePayload({
      geometry: {
        type: 'Point',
        coordinates: [
          30,
          60,
        ],
      },
      pointTypeId: 12,
    });

  assert.equal(
    point.family,
    'point',
  );
  assert.equal(
    point.pointTypeId,
    12,
  );
  assert.equal(
    point.lineTypeId,
    null,
  );
  assert.equal(
    point.lanes,
    null,
  );

  assert.throws(
    () =>
      normalizeGeometryCreatePayload({
        geometry: {
          type: 'LineString',
          coordinates: [
            [30, 60],
            [31, 61],
          ],
        },
        lineTypeId: 7,
        pointTypeId: 12,
        lanes: 1,
      }),
    /pointTypeId/u,
  );

  assert.throws(
    () =>
      normalizeGeometryCreatePayload({
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [30, 60],
            [31, 60],
            [31, 61],
            [30, 60],
          ]],
        },
        pointTypeId: 12,
      }),
    /point/u,
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


test('geometry merge request requires distinct optimistic revisions', () => {
  const items =
    normalizeGeometryMergeRequest({
      items: [
        {
          id: 9,
          baseUpdatedAt:
            '2026-09-25T12:00:00Z',
        },
        {
          id: 4,
          baseUpdatedAt:
            '2026-09-25T12:05:00Z',
        },
      ],
    });

  assert.deepEqual(
    items,
    [
      {
        id: 9,
        baseUpdatedAt:
          '2026-09-25T12:00:00.000Z',
      },
      {
        id: 4,
        baseUpdatedAt:
          '2026-09-25T12:05:00.000Z',
      },
    ],
  );

  assert.throws(
    () =>
      normalizeGeometryMergeRequest({
        items: [
          {
            id: 9,
            baseUpdatedAt:
              '2026-09-25T12:00:00Z',
          },
          {
            id: 9,
            baseUpdatedAt:
              '2026-09-25T12:05:00Z',
          },
        ],
      }),
    /Duplicate geometry id in merge/u,
  );
});

test('geometry cut request accepts inline or optimistic referenced polygon cutters', () => {
  assert.deepEqual(
    normalizeGeometryCutRequest({
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [30, 60],
          [31, 60],
          [31, 61],
          [30, 60],
        ]],
      },
    }),
    {
      kind: 'inline',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [30, 60],
          [31, 60],
          [31, 61],
          [30, 60],
        ]],
      },
    },
  );

  assert.deepEqual(
    normalizeGeometryCutRequest({
      cutterGeometryId: 17,
      cutterUpdatedAt:
        '2026-09-29T01:00:00Z',
    }),
    {
      kind: 'geometry',
      geometryId: 17,
      baseUpdatedAt:
        '2026-09-29T01:00:00.000Z',
    },
  );

  assert.throws(
    () =>
      normalizeGeometryCutRequest({
        geometry: {
          type:
            'LineString',
          coordinates: [
            [30, 60],
            [31, 61],
          ],
        },
      }),
    /Cut geometry must be Polygon or MultiPolygon/u,
  );

  assert.throws(
    () =>
      normalizeGeometryCutRequest({
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [30, 60],
            [31, 60],
            [31, 61],
            [30, 60],
          ]],
        },
        cutterGeometryId: 17,
        cutterUpdatedAt:
          '2026-09-29T01:00:00Z',
      }),
    /exactly one cutter source/u,
  );
});

test('geometry split request requires a line blade', () => {
  assert.deepEqual(
    normalizeGeometrySplitRequest({
      blade: {
        type: 'LineString',
        coordinates: [
          [30, 60],
          [31, 61],
        ],
      },
    }),
    {
      type: 'LineString',
      coordinates: [
        [30, 60],
        [31, 61],
      ],
    },
  );

  assert.throws(
    () =>
      normalizeGeometrySplitRequest({
        blade: {
          type: 'Polygon',
          coordinates: [[
            [30, 60],
            [31, 60],
            [31, 61],
            [30, 60],
          ]],
        },
      }),
    /Split blade must be LineString or MultiLineString/u,
  );
});
