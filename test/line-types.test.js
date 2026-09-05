import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLineTypesPlan,
  LineTypeValidationError,
  normalizeLineTypeCode,
} from '../src/data/line-types.js';
import { createLineTypesRepository } from '../src/db/line-types-repository.js';

const payload = {
  lineTypes: [
    {
      type: 'default',
      name: 'Выделенные полосы',
      color: '#045B69',
      style: 'solid',
      width: 4,
    },
    {
      type: 'tram-priority',
      name: 'Приоритет трамвая',
      color: '#CC4400',
      style: 'dashed',
      width: 6.5,
    },
  ],
};

test('line type plan validates and normalizes portable styles', () => {
  assert.equal(normalizeLineTypeCode(undefined), 'default');
  const plan = buildLineTypesPlan(payload);
  assert.deepEqual(plan.lineTypes, [
    {
      type: 'default',
      name: 'Выделенные полосы',
      color: '#045b69',
      style: 'solid',
      width: 4,
    },
    {
      type: 'tram-priority',
      name: 'Приоритет трамвая',
      color: '#cc4400',
      style: 'dashed',
      width: 6.5,
    },
  ]);
});

test('line type plan requires default and rejects invalid styles', () => {
  assert.throws(
    () => buildLineTypesPlan({ lineTypes: [payload.lineTypes[1]] }),
    /must contain the default type/,
  );
  assert.throws(
    () => buildLineTypesPlan({
      lineTypes: [{ ...payload.lineTypes[0], color: 'red' }],
    }),
    LineTypeValidationError,
  );
  assert.throws(
    () => buildLineTypesPlan({
      lineTypes: [{ ...payload.lineTypes[0], style: 'zigzag' }],
    }),
    /must be one of/,
  );
  assert.throws(
    () => buildLineTypesPlan({
      lineTypes: [payload.lineTypes[0], { ...payload.lineTypes[0] }],
    }),
    /Duplicate line type/,
  );
});

function createPool({ referencedOmitted = [] } = {}) {
  const queries = [];
  let released = false;
  const rows = [
    {
      id: 1,
      type: 'default',
      name: 'Выделенные полосы',
      color: '#045b69',
      style: 'solid',
      width: 4,
      geometryCount: 10,
    },
    {
      id: 2,
      type: 'tram-priority',
      name: 'Приоритет трамвая',
      color: '#cc4400',
      style: 'dashed',
      width: 6.5,
      geometryCount: 0,
    },
  ];
  const client = {
    async query(text) {
      const normalized = text.trim();
      queries.push(normalized);
      if (
        normalized.startsWith('SELECT') &&
        normalized.includes('line_type.id::integer AS id')
      ) {
        return { rows, rowCount: rows.length };
      }
      if (normalized.startsWith('SELECT line_type.code')) {
        return { rows: referencedOmitted, rowCount: referencedOmitted.length };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };
  return {
    queries,
    get released() {
      return released;
    },
    async query(text) {
      return client.query(text);
    },
    async connect() {
      return client;
    },
  };
}

test('line type repository saves a complete style dictionary atomically', async () => {
  const pool = createPool();
  const repository = createLineTypesRepository(pool);

  const result = await repository.save(payload);

  assert.equal(result.length, 2);
  assert.equal(pool.queries[0], 'BEGIN');
  assert.ok(pool.queries.some((query) => query.startsWith('CREATE TEMP TABLE line_type_settings_stage')));
  assert.ok(pool.queries.some((query) => query.startsWith('INSERT INTO line_types')));
  assert.ok(pool.queries.some((query) => query.startsWith('DELETE FROM line_types AS line_type')));
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('line type repository refuses to remove a type used by geometries', async () => {
  const pool = createPool({
    referencedOmitted: [{ code: 'tram-priority', geometry_count: 4 }],
  });
  const repository = createLineTypesRepository(pool);

  await assert.rejects(
    repository.save({ lineTypes: [payload.lineTypes[0]] }),
    /tram-priority \(4\)/,
  );
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
  assert.equal(pool.released, true);
});
