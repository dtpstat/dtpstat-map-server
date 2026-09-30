import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GeometryEditorValidationError,
  geometryFamily,
  normalizeGeometryBulkUpdates,
  normalizeGeometryCreatePayload,
  normalizeGeometryChanges,
  normalizeGeometrySyncRequest,
  normalizeGeometryTags,
  validateEditorGeometry,
} from '../src/modules/geometry/editor-policy.js';
import {
  normalizeGeometryCutPreviewRequest,
  normalizeGeometrySplitPreviewRequest,
  normalizeGeometryUnionPreviewRequest,
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

test('geometry editor keeps longitude inclusive and latitude strictly inside the poles', () => {
  assert.deepEqual(
    validateEditorGeometry({
      type: 'Point',
      coordinates: [
        180,
        89.999999,
      ],
    }),
    {
      type: 'Point',
      coordinates: [
        180,
        89.999999,
      ],
    },
  );

  for (const latitude of [
    -90,
    90,
  ]) {
    assert.throws(
      () =>
        validateEditorGeometry({
          type: 'Point',
          coordinates: [
            0,
            latitude,
          ],
        }),
      /outside supported longitude\/latitude bounds/u,
    );
  }

  assert.throws(
    () =>
      validateEditorGeometry({
        type: 'Point',
        coordinates: [
          180.000001,
          0,
        ],
      }),
    /outside supported longitude\/latitude bounds/u,
  );
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


test('geometry sync create can clone immutable metadata only from an explicit source id', () => {
  const request =
    normalizeGeometrySyncRequest({
      items: [{
        kind: 'create',
        localId:
          'local:part-2',
        sourceGeometryId:
          17,
        value: {
          geometry: {
            type:
              'LineString',
            coordinates: [
              [30, 60],
              [31, 61],
            ],
          },
          lineTypeId:
            7,
          lanes:
            1,
        },
      }],
    });

  assert.equal(
    request[0]
      .sourceGeometryId,
    17,
  );

  assert.throws(
    () =>
      normalizeGeometrySyncRequest({
        items: [{
          kind: 'create',
          localId:
            'local:part-2',
          sourceGeometryId:
            'not-an-id',
          value: {
            geometry: {
              type:
                'LineString',
              coordinates: [
                [30, 60],
                [31, 61],
              ],
            },
            lineTypeId:
              7,
            lanes:
              1,
          },
        }],
      }),
    /sourceGeometryId/u,
  );
});


test('geometry sync accepts optimistic delete operations', () => {
  assert.deepEqual(
    normalizeGeometrySyncRequest({
      items: [{
        kind:
          'delete',
        id:
          17,
        baseUpdatedAt:
          '2026-09-25T12:00:00Z',
        editToken:
          '0123456789abcdef',
      }],
    }),
    [{
      kind:
        'delete',
      id:
        17,
      baseUpdatedAt:
        '2026-09-25T12:00:00.000Z',
      editToken:
        '0123456789abcdef',
    }],
  );
});


test('geometry topology preview requests validate complete local GeoJSON inputs', () => {
  const sourceLine = {
    type:
      'LineString',
    coordinates: [
      [30, 60],
      [31, 61],
    ],
  };
  const secondLine = {
    type:
      'LineString',
    coordinates: [
      [31, 61],
      [32, 62],
    ],
  };

  assert.deepEqual(
    normalizeGeometryUnionPreviewRequest({
      geometries: [
        sourceLine,
        secondLine,
      ],
    }),
    {
      geometries: [
        sourceLine,
        secondLine,
      ],
      family:
        'line',
    },
  );

  assert.throws(
    () =>
      normalizeGeometryUnionPreviewRequest({
        geometries: [
          sourceLine,
          {
            type:
              'Polygon',
            coordinates: [[
              [30, 60],
              [31, 60],
              [31, 61],
              [30, 60],
            ]],
          },
        ],
      }),
    /same family/u,
  );

  const sourcePolygon = {
    type: 'Polygon',
    coordinates: [[
      [30, 60],
      [32, 60],
      [32, 62],
      [30, 60],
    ]],
  };
  const cutterPolygon = {
    type: 'Polygon',
    coordinates: [[
      [30.5, 60.2],
      [31, 60.2],
      [31, 60.8],
      [30.5, 60.2],
    ]],
  };

  assert.deepEqual(
    normalizeGeometryCutPreviewRequest({
      sourceGeometry:
        sourcePolygon,
      cutterGeometry:
        cutterPolygon,
    }),
    {
      sourceGeometry:
        sourcePolygon,
      cutterGeometry:
        cutterPolygon,
    },
  );

  assert.deepEqual(
    normalizeGeometrySplitPreviewRequest({
      sourceGeometry: {
        type: 'LineString',
        coordinates: [
          [30, 60],
          [32, 62],
        ],
      },
      blade: {
        type: 'LineString',
        coordinates: [
          [31, 59],
          [31, 63],
        ],
      },
    }),
    {
      sourceGeometry: {
        type: 'LineString',
        coordinates: [
          [30, 60],
          [32, 62],
        ],
      },
      blade: {
        type: 'LineString',
        coordinates: [
          [31, 59],
          [31, 63],
        ],
      },
      family: 'line',
    },
  );

  assert.throws(
    () =>
      normalizeGeometryCutPreviewRequest({
        sourceGeometry: {
          type: 'LineString',
          coordinates: [
            [30, 60],
            [31, 61],
          ],
        },
        cutterGeometry:
          cutterPolygon,
      }),
    /source must be Polygon or MultiPolygon/u,
  );

  assert.throws(
    () =>
      normalizeGeometrySplitPreviewRequest({
        sourceGeometry: {
          type: 'Point',
          coordinates:
            [30, 60],
        },
        blade: {
          type: 'LineString',
          coordinates: [
            [29, 60],
            [31, 60],
          ],
        },
      }),
    /source must be a line or polygon/u,
  );
});


test('geometry display zoom and validity dates are optional and ordered', () => {
  const base = {
    geometry: {
      type: 'Point',
      coordinates: [37.6, 55.7],
    },
    minZoom: 10.5,
    maxZoom: 18,
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
  };

  const created =
    normalizeGeometryCreatePayload(
      base,
    );
  assert.equal(created.minZoom, 10.5);
  assert.equal(created.maxZoom, 18);
  assert.equal(created.validFrom, '2026-01-01');
  assert.equal(created.validTo, '2026-12-31');

  assert.throws(
    () =>
      normalizeGeometryCreatePayload({
        ...base,
        minZoom: 19,
        maxZoom: 18,
      }),
    /minZoom must not be greater/u,
  );
  assert.throws(
    () =>
      normalizeGeometryCreatePayload({
        ...base,
        validFrom: '2027-01-01',
        validTo: '2026-12-31',
      }),
    /validFrom must not be later/u,
  );
  assert.throws(
    () =>
      normalizeGeometryChanges({
        validFrom: '2026-02-30',
      }),
    /valid calendar date/u,
  );
});
