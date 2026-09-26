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


function polygonGeometry(
  id,
  updatedAt,
) {
  return {
    id,
    cityId: 1,
    boundaryId: 10,
    family:
      'polygon',
    geometryType:
      'POLYGON',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [30, 60],
        [32, 60],
        [32, 62],
        [30, 60],
      ]],
    },
    displayName:
      `Polygon ${id}`,
    tooltip: null,
    tags: [],
    sourceTags: {
      source:
        'integration',
    },
    isVisible: true,
    lineTypeId: null,
    lanes: null,
    updatedAt,
  };
}

function operationFixture(
  rows,
) {
  const queries = [];
  const merges = [];
  const cuts = [];

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
      return structuredClone(
        rows,
      );
    },
    async mergeGeometries(
      _client,
      ids,
      family,
      preserveSourceTags,
    ) {
      merges.push({
        ids:
          [...ids],
        family,
        preserveSourceTags,
      });

      return {
        ...structuredClone(
          rows.find(
            (item) =>
              item.id ===
              ids[0],
          ),
        ),
        updatedAt:
          '2026-09-25T13:00:00.000Z',
      };
    },
    async cutGeometry(
      _client,
      id,
      cutter,
    ) {
      cuts.push({
        id,
        cutter:
          structuredClone(
            cutter,
          ),
      });

      return {
        ...structuredClone(
          rows.find(
            (item) =>
              item.id === id,
          ),
        ),
        updatedAt:
          '2026-09-25T13:00:00.000Z',
      };
    },
  };

  return {
    service:
      createGeometryEditorService(
        pool,
        {
          storage,
          async acquireLock() {},
        },
      ),
    queries,
    merges,
    cuts,
  };
}

test('geometry merge validates every source revision before one transactional merge', async () => {
  const first = {
    ...geometry(
      2,
      '2026-09-25T12:00:00.000Z',
    ),
    sourceTags: {
      source: 'same',
    },
  };
  const second = {
    ...geometry(
      5,
      '2026-09-25T12:05:00.000Z',
    ),
    sourceTags: {
      source: 'same',
    },
  };

  const {
    service,
    queries,
    merges,
  } =
    operationFixture([
      first,
      second,
    ]);

  const result =
    await service.merge({
      items: [
        {
          id: 5,
          baseUpdatedAt:
            second.updatedAt,
        },
        {
          id: 2,
          baseUpdatedAt:
            first.updatedAt,
        },
      ],
    });

  assert.deepEqual(
    result
      .sourceGeometryIds,
    [5, 2],
  );
  assert.equal(
    result.geometry.id,
    5,
  );
  assert.deepEqual(
    merges,
    [{
      ids: [5, 2],
      family: 'line',
      preserveSourceTags:
        true,
    }],
  );
  assert.ok(
    queries.includes(
      'COMMIT',
    ),
  );
});

test('geometry merge conflict rolls back before spatial merge', async () => {
  const current =
    geometry(
      2,
      '2026-09-25T12:10:00.000Z',
    );
  const second =
    geometry(
      5,
      '2026-09-25T12:05:00.000Z',
    );

  const {
    service,
    queries,
    merges,
  } =
    operationFixture([
      current,
      second,
    ]);

  await assert.rejects(
    service.merge({
      items: [
        {
          id: 2,
          baseUpdatedAt:
            '2026-09-25T12:00:00.000Z',
        },
        {
          id: 5,
          baseUpdatedAt:
            second.updatedAt,
        },
      ],
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
    merges.length,
    0,
  );
  assert.ok(
    queries.includes(
      'ROLLBACK',
    ),
  );
});

test('geometry cut requires current polygon revision before spatial difference', async () => {
  const current =
    polygonGeometry(
      11,
      '2026-09-25T12:10:00.000Z',
    );

  const {
    service,
    queries,
    cuts,
  } =
    operationFixture([
      current,
    ]);

  const cutter = {
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [30.5, 60.1],
        [31, 60.1],
        [31, 60.5],
        [30.5, 60.1],
      ]],
    },
  };

  const result =
    await service.cut(
      11,
      cutter,
      {
        expectedUpdatedAt:
          current.updatedAt,
      },
    );

  assert.equal(
    result.id,
    11,
  );
  assert.equal(
    cuts.length,
    1,
  );
  assert.deepEqual(
    cuts[0].cutter,
    cutter.geometry,
  );
  assert.ok(
    queries.includes(
      'COMMIT',
    ),
  );

  const stale =
    operationFixture([
      current,
    ]);

  await assert.rejects(
    stale.service.cut(
      11,
      cutter,
      {
        expectedUpdatedAt:
          '2026-09-25T12:00:00.000Z',
      },
    ),
    (error) => {
      assert.equal(
        error.statusCode,
        409,
      );
      return true;
    },
  );

  assert.equal(
    stale.cuts.length,
    0,
  );
  assert.ok(
    stale.queries.includes(
      'ROLLBACK',
    ),
  );
});
