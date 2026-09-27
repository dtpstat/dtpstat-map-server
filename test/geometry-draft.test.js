import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyGeometryDraft,
  geometryDraftChanges,
  geometryDraftIsStale,
  normalizedRevision,
} from '../admin/geometry-draft.js';

const server = {
  id: 7,
  geometry: {
    type: 'LineString',
    coordinates: [
      [30, 60],
      [31, 61],
    ],
  },
  displayName: 'Линия',
  tooltip: null,
  tags: ['центр'],
  isVisible: true,
  lineTypeId: 2,
  lanes: 1,
  updatedAt:
    '2026-09-25T12:00:00.000Z',
};

test('geometry draft stores only changed editable values', () => {
  const edited = {
    ...structuredClone(server),
    displayName:
      'Новая линия',
    isVisible: false,
    geometry: {
      type: 'LineString',
      coordinates: [
        [30, 60],
        [32, 62],
      ],
    },
  };

  assert.deepEqual(
    geometryDraftChanges(
      server,
      edited,
    ),
    {
      geometry:
        edited.geometry,
      displayName:
        'Новая линия',
      isVisible: false,
    },
  );
});

test('geometry draft overlay preserves server metadata and exposes conflict state', () => {
  const effective =
    applyGeometryDraft(
      server,
      {
        baseUpdatedAt:
          server.updatedAt,
        changes: {
          displayName:
            'Черновик',
          lanes: 2,
        },
        conflict: true,
      },
    );

  assert.equal(
    effective.id,
    7,
  );
  assert.equal(
    effective.displayName,
    'Черновик',
  );
  assert.equal(
    effective.lanes,
    2,
  );
  assert.equal(
    effective._draft,
    true,
  );
  assert.equal(
    effective._conflict,
    true,
  );
});

test('geometry draft revision comparison normalizes equivalent timestamps', () => {
  const draft = {
    baseUpdatedAt:
      '2026-09-25T12:00:00Z',
    changes: {
      displayName:
        'Черновик',
    },
  };

  assert.equal(
    normalizedRevision(
      draft.baseUpdatedAt,
    ),
    '2026-09-25T12:00:00.000Z',
  );
  assert.equal(
    geometryDraftIsStale(
      '2026-09-25T12:00:00.000Z',
      draft,
    ),
    false,
  );
  assert.equal(
    geometryDraftIsStale(
      '2026-09-25T12:00:01.000Z',
      draft,
    ),
    true,
  );
});
