import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGeometryImportService,
} from '../src/modules/geometry/import-service.js';

function fixture() {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      return {
        rows: [],
        rowCount: 0,
      };
    },
    release() {
      calls.push(
        'RELEASE',
      );
    },
  };
  const pool = {
    async connect() {
      calls.push(
        'CONNECT',
      );
      return client;
    },
  };
  const storage = {
    async pending() {
      calls.push(
        'PENDING',
      );
      return {
        id: 9,
      };
    },
    async discardInTransaction(
      _client,
      id,
    ) {
      calls.push(
        ['DISCARD', id],
      );
      return {
        id,
      };
    },
    async applyInTransaction(
      _client,
      id,
      decisions,
    ) {
      calls.push(
        [
          'APPLY',
          id,
          decisions,
        ],
      );
      return {
        sessionId: id,
        status:
          'applied',
      };
    },
    async assertNoPending() {},
    async stageKml() {},
  };

  const service =
    createGeometryImportService(
      pool,
      {
        storage,
        async acquireLock() {
          calls.push(
            'LOCK',
          );
        },
      },
    );

  return {
    service,
    calls,
  };
}

test('geometry import discard is serialized by the destructive data lock', async () => {
  const {
    service,
    calls,
  } =
    fixture();

  const result =
    await service.discard(
      9,
    );

  assert.deepEqual(
    result,
    {
      id: 9,
    },
  );
  assert.deepEqual(
    calls,
    [
      'CONNECT',
      'BEGIN',
      'LOCK',
      ['DISCARD', 9],
      'COMMIT',
      'RELEASE',
    ],
  );
});

test('geometry import apply validates decisions then commits one atomic transaction', async () => {
  const {
    service,
    calls,
  } =
    fixture();
  const progress = [];
  let commitStarted =
    false;

  const result =
    await service.apply(
      9,
      [{
        incomingId: 4,
        action:
          'replace',
        replaceExistingIds: [
          12,
        ],
      }],
      {
        onProgress(value) {
          progress.push(
            value,
          );
        },
        onCommit() {
          commitStarted =
            true;
        },
      },
    );

  assert.equal(
    result.status,
    'applied',
  );
  assert.deepEqual(
    progress,
    [{
      phase:
        'import-conflicts-apply',
      sessionId: 9,
    }],
  );
  assert.equal(
    commitStarted,
    true,
  );
  assert.equal(
    calls.some(
      (entry) =>
        Array.isArray(
          entry,
        ) &&
        entry[0] ===
          'APPLY',
    ),
    true,
  );
  assert.equal(
    calls.includes(
      'COMMIT',
    ),
    true,
  );
});
