import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CITY_BOUNDARY_HIERARCHY_BATCH_SIZE,
  rebuildCityBoundaryHierarchy,
} from '../src/db/city-boundary-hierarchy.js';

function fakeClient(total) {
  const calls = [];
  return {
    calls,
    async query(text, values = []) {
      const normalized = text.trim();
      calls.push({ text: normalized, values });
      if (normalized.startsWith('SELECT count(*)::integer AS count')) {
        return { rows: [{ count: total }], rowCount: 1 };
      }
      if (
        normalized.startsWith('WITH batch AS') &&
        normalized.includes('ST_Covers(parent.geom, child.geom)')
      ) {
        const afterId = Number(values[0]);
        const batchSize = Number(values[1]);
        const count = Math.max(
          0,
          Math.min(batchSize, total - afterId),
        );
        return {
          rows: [{
            count,
            lastId: count > 0 ? String(afterId + count) : null,
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
}

test('boundary hierarchy rebuild is split into bounded observable batches', async () => {
  const client = fakeClient(620);
  const progress = [];

  const result = await rebuildCityBoundaryHierarchy(client, {
    onProgress(value) {
      progress.push(value);
    },
  });

  assert.equal(CITY_BOUNDARY_HIERARCHY_BATCH_SIZE, 250);
  assert.deepEqual(result, {
    processed: 620,
    total: 620,
    batch: 3,
    batchCount: 3,
  });
  assert.deepEqual(
    progress.map((value) => value.processed),
    [0, 250, 500, 620],
  );
  assert.deepEqual(
    progress.map((value) => value.batch),
    [0, 1, 2, 3],
  );

  const batches = client.calls.filter((call) =>
    call.text.startsWith('WITH batch AS'));
  assert.deepEqual(
    batches.map((call) => call.values),
    [['0', 250], ['250', 250], ['500', 250]],
  );
  assert.ok(
    batches.every((call) =>
      call.text.includes('parent.area_m2 > child.area_m2')),
  );
  assert.ok(
    batches.every((call) =>
      !call.text.includes('ST_Area(')),
  );
});
