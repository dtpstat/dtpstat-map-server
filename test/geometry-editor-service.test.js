import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGeometryEditorService,
} from '../src/modules/geometry/editor-service.js';

function geometry(
  id,
  updatedAt,
) {
  return {
    id,
    cityId: 1,
    boundaryId: 10,
    family: 'line',
    geometryType:
      'LINESTRING',
    geometry: {
      type: 'LineString',
      coordinates: [
        [30, 60],
        [31, 61],
      ],
    },
    displayName:
      `Geometry ${id}`,
    tooltip: null,
    tags: [],
    isVisible: true,
    lineTypeId: 7,
    lanes: 1,
    updatedAt,
  };
}

function fixture(rows) {
  const queries = [];
  const writes = [];
  const client = {
    async query(text) {
      queries.push(text);
      return {
        rows: [],
        rowCount: 0,
      };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  };
  const storage = {
    async assertNoPendingImport() {},
    async assertInvariants() {},
    async lockGeometries() {
      return structuredClone(rows);
    },
    async lineTypeExists() {
      return true;
    },
    async updateGeometry(
      _client,
      id,
      value,
    ) {
      writes.push({
        id,
        value:
          structuredClone(value),
      });
      return {
        ...geometry(
          id,
          '2026-09-25T13:00:00.000Z',
        ),
        ...structuredClone(value),
      };
    },
  };
  const service =
    createGeometryEditorService(
      pool,
      {
        storage,
        async acquireLock() {},
      },
    );

  return {
    service,
    queries,
    writes,
  };
}

test('geometry bulk update locks and validates every revision before writing atomically', async () => {
  const first =
    geometry(
      2,
      '2026-09-25T12:00:00.000Z',
    );
  const second =
    geometry(
      5,
      '2026-09-25T12:05:00.000Z',
    );
  const {
    service,
    queries,
    writes,
  } =
    fixture([
      first,
      second,
    ]);

  const result =
    await service.updateMany({
      updates: [
        {
          id: 5,
          baseUpdatedAt:
            second.updatedAt,
          changes: {
            displayName:
              'Пять',
          },
        },
        {
          id: 2,
          baseUpdatedAt:
            first.updatedAt,
          changes: {
            isVisible:
              false,
          },
        },
      ],
    });

  assert.equal(
    result.changedCount,
    2,
  );
  assert.deepEqual(
    result.entityIds,
    [5, 2],
  );
  assert.deepEqual(
    writes.map(
      (entry) =>
        entry.id,
    ),
    [5, 2],
  );
  assert.ok(
    queries.includes(
      'COMMIT',
    ),
  );
  assert.equal(
    queries.includes(
      'ROLLBACK',
    ),
    false,
  );
});

test('geometry bulk conflict rolls back before the first write', async () => {
  const current =
    geometry(
      2,
      '2026-09-25T12:10:00.000Z',
    );
  const {
    service,
    queries,
    writes,
  } =
    fixture([
      current,
    ]);

  await assert.rejects(
    service.updateMany({
      updates: [{
        id: 2,
        baseUpdatedAt:
          '2026-09-25T12:00:00.000Z',
        changes: {
          displayName:
            'Устаревший черновик',
        },
      }],
    }),
    (error) => {
      assert.equal(
        error.statusCode,
        409,
      );
      assert.equal(
        error.details
          .conflicts[0]
          .id,
        2,
      );
      return true;
    },
  );

  assert.equal(
    writes.length,
    0,
  );
  assert.ok(
    queries.includes(
      'ROLLBACK',
    ),
  );
});
