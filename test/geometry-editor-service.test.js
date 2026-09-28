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

function serviceDependencies(
  storage,
  tokenSuffix = '1',
  leaseOverrides = {},
) {
  return {
    storage,
    leaseStorage: {
      async owns() {
        return true;
      },
      async active() {
        return null;
      },
      async acquire(
        _client,
        {
          geometryId,
          token,
          userId,
          clientId,
        },
      ) {
        return {
          geometryId,
          token,
          userId,
          username:
            'tester',
          clientId,
          generation: 1,
          acquiredAt:
            '2026-09-25T12:00:00.000Z',
          lastSeenAt:
            '2026-09-25T12:00:00.000Z',
          expiresAt:
            '2026-09-25T12:01:30.000Z',
        };
      },
      async release() {
        return true;
      },
      ...leaseOverrides,
    },
    async acquireLock() {},
    randomUUID:
      () =>
        `00000000-0000-4000-8000-${tokenSuffix.padStart(
          12,
          '0',
        )}`,
    leaseSeconds: 90,
  };
}

function fixture(rows) {
  const queries = [];
  const writes = [];
  const current =
    new Map(
      rows.map(
        (row) => [
          row.id,
          structuredClone(row),
        ],
      ),
    );

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
    async relinkGeometry() {},
    async getGeometry(
      _queryable,
      id,
    ) {
      return structuredClone(
        current.get(id),
      );
    },
    async lockGeometries() {
      return structuredClone(
        rows,
      );
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
      const updated = {
        ...geometry(
          id,
          '2026-09-25T13:00:00.000Z',
        ),
        ...structuredClone(value),
      };
      current.set(
        id,
        updated,
      );
      return structuredClone(
        updated,
      );
    },
  };
  const service =
    createGeometryEditorService(
      pool,
      serviceDependencies(
        storage,
        '1',
      ),
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
  leaseOverrides = {},
) {
  const queries = [];
  const merges = [];
  const cuts = [];
  const current =
    new Map(
      rows.map(
        (row) => [
          row.id,
          structuredClone(row),
        ],
      ),
    );

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
    async relinkGeometry() {},
    async getGeometry(
      _queryable,
      id,
    ) {
      return structuredClone(
        current.get(id),
      );
    },
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

      const merged = {
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
      current.set(
        ids[0],
        merged,
      );
      for (
        const sourceId of
        ids.slice(1)
      ) {
        current.delete(
          sourceId,
        );
      }
      return structuredClone(
        merged,
      );
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

      const cut = {
        ...structuredClone(
          rows.find(
            (item) =>
              item.id === id,
          ),
        ),
        updatedAt:
          '2026-09-25T13:00:00.000Z',
      };
      current.set(
        id,
        cut,
      );
      return structuredClone(
        cut,
      );
    },
  };

  return {
    service:
      createGeometryEditorService(
        pool,
        serviceDependencies(
          storage,
          '2',
          leaseOverrides,
        ),
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
    }, {
      id: 77,
    }, 'test-client');

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
    }, {
      id: 77,
    }, 'test-client'),
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

test('geometry merge rolls back when any source has an active edit lease', async () => {
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

  const blocked =
    operationFixture(
      [
        first,
        second,
      ],
      {
        async acquire(
          _client,
          {
            geometryId,
            token,
            userId,
            clientId,
          },
        ) {
          return {
            geometryId,
            token:
              geometryId === 5
                ? 'foreign-edit-token'
                : token,
            userId,
            username:
              geometryId === 5
                ? 'other-editor'
                : 'tester',
            clientId:
              geometryId === 5
                ? 'other-client'
                : clientId,
            generation: 1,
            acquiredAt:
              '2026-09-25T12:00:00.000Z',
            lastSeenAt:
              '2026-09-25T12:00:00.000Z',
            expiresAt:
              '2026-09-25T12:01:30.000Z',
          };
        },
      },
    );

  await assert.rejects(
    blocked.service.merge(
      {
        items: [
          {
            id: 2,
            baseUpdatedAt:
              first.updatedAt,
          },
          {
            id: 5,
            baseUpdatedAt:
              second.updatedAt,
          },
        ],
      },
      {
        id: 77,
      },
      'test-client',
    ),
    (error) => {
      assert.equal(
        error.statusCode,
        409,
      );
      assert.equal(
        error.details
          .conflicts[0]
          .id,
        5,
      );
      assert.equal(
        error.details
          .conflicts[0]
          .reason,
        'edit-lock',
      );
      return true;
    },
  );

  assert.equal(
    blocked.merges.length,
    0,
  );
  assert.ok(
    blocked.queries.includes(
      'ROLLBACK',
    ),
  );
});


test('geometry cut refuses a token that no longer owns the edit lease', async () => {
  const current =
    polygonGeometry(
      11,
      '2026-09-25T12:10:00.000Z',
    );

  const blocked =
    operationFixture(
      [current],
      {
        async owns() {
          return false;
        },
        async active() {
          return {
            geometryId: 11,
            token:
              'foreign-edit-token',
            userId: 88,
            username:
              'other-editor',
            clientId:
              'other-client',
            generation: 2,
            acquiredAt:
              '2026-09-25T12:00:00.000Z',
            lastSeenAt:
              '2026-09-25T12:00:00.000Z',
            expiresAt:
              '2026-09-25T12:01:30.000Z',
          };
        },
      },
    );

  await assert.rejects(
    blocked.service.cut(
      11,
      {
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [30.5, 60.1],
            [31, 60.1],
            [31, 60.5],
            [30.5, 60.1],
          ]],
        },
      },
      {
        expectedUpdatedAt:
          current.updatedAt,
        editToken:
          '0123456789abcdef',
      },
      {
        id: 77,
      },
    ),
    (error) => {
      assert.equal(
        error.statusCode,
        409,
      );
      assert.equal(
        error.details
          .conflicts[0]
          .reason,
        'edit-lock',
      );
      return true;
    },
  );

  assert.equal(
    blocked.cuts.length,
    0,
  );
  assert.ok(
    blocked.queries.includes(
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
        editToken:
          '0123456789abcdef',
      },
      {
        id: 77,
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
        editToken:
          '0123456789abcdef',
      },
      {
        id: 77,
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
