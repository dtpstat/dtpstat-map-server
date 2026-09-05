import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLineTypesPlan,
  buildLineTypeSettingsPlan,
  LineTypeValidationError,
  normalizeLineTypeCode,
} from '../src/data/line-types.js';
import { createLineTypesRepository } from '../src/db/line-types-repository.js';

const dictionary = {
  lineTypes: [
    {
      code: 0,
      name: 'default',
      title: 'Выделенные полосы',
      color: '#045B69',
      style: 'solid',
      width: 4,
    },
    {
      code: 7,
      name: 'Двусторонние',
      title: 'Двусторонние полосы',
      color: '#CC4400',
      style: 'dashed',
      width: 6.5,
    },
  ],
};

const settings = {
  lineTypes: dictionary.lineTypes.map(({ code, title, color, style, width }) => ({
    code,
    title,
    color,
    style,
    width,
  })),
};

test('line type plan validates numeric portable codes and styles', () => {
  assert.equal(normalizeLineTypeCode('7'), 7);
  assert.throws(() => normalizeLineTypeCode('default'), LineTypeValidationError);
  const plan = buildLineTypesPlan(dictionary);
  assert.equal(plan.lineTypes[0].code, 0);
  assert.equal(plan.lineTypes[1].code, 7);
  assert.equal(plan.lineTypes[1].name, 'Двусторонние');
  assert.equal(plan.lineTypes[1].title, 'Двусторонние полосы');
  assert.equal(plan.lineTypes[1].color, '#cc4400');
});

test('import names are trimmed, keep case, and are unique ignoring case', () => {
  const plan = buildLineTypesPlan({
    lineTypes: [
      { ...dictionary.lineTypes[0], name: '  default  ' },
      { ...dictionary.lineTypes[1], name: '  Двусторонние  ' },
    ],
  });
  assert.equal(plan.lineTypes[0].name, 'default');
  assert.equal(plan.lineTypes[1].name, 'Двусторонние');

  assert.throws(
    () => buildLineTypesPlan({
      lineTypes: [
        dictionary.lineTypes[0],
        { ...dictionary.lineTypes[1], code: 8, name: ' DEFAULT ' },
      ],
    }),
    /Duplicate line type name ignoring case/,
  );
});

test('line type plan rejects duplicate numeric codes and invalid styles', () => {
  assert.throws(
    () => buildLineTypesPlan({
      lineTypes: [dictionary.lineTypes[0], { ...dictionary.lineTypes[1], code: 0 }],
    }),
    /Duplicate line type code/,
  );
  assert.throws(
    () => buildLineTypesPlan({
      lineTypes: [{ ...dictionary.lineTypes[0], color: 'red' }],
    }),
    LineTypeValidationError,
  );
  assert.throws(
    () => buildLineTypesPlan({
      lineTypes: [{ ...dictionary.lineTypes[0], style: 'zigzag' }],
    }),
    /must be one of/,
  );
});

test('admin settings cannot modify imported name or code identity', () => {
  assert.deepEqual(buildLineTypeSettingsPlan(settings).lineTypes, [
    { code: 0, title: 'Выделенные полосы', color: '#045b69', style: 'solid', width: 4 },
    { code: 7, title: 'Двусторонние полосы', color: '#cc4400', style: 'dashed', width: 6.5 },
  ]);
  assert.throws(
    () => buildLineTypeSettingsPlan({
      lineTypes: [{ ...settings.lineTypes[0], name: 'changed' }],
    }),
    /unsupported properties: name/,
  );
});

function createPool({ unknownCodes = [] } = {}) {
  const queries = [];
  let released = false;
  const rows = [
    {
      id: 1,
      code: 0,
      name: 'default',
      title: 'Выделенные полосы',
      color: '#045b69',
      style: 'solid',
      width: 4,
      geometryCount: 10,
    },
    {
      id: 2,
      code: 7,
      name: 'Двусторонние',
      title: 'Двусторонние полосы',
      color: '#cc4400',
      style: 'dashed',
      width: 6.5,
      geometryCount: 4,
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
      if (normalized.startsWith('SELECT stage.code')) {
        return { rows: unknownCodes.map((code) => ({ code })), rowCount: unknownCodes.length };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };
  return {
    queries,
    get released() { return released; },
    async query(text) { return client.query(text); },
    async connect() { return client; },
  };
}

test('line type repository updates only title and style settings atomically', async () => {
  const pool = createPool();
  const repository = createLineTypesRepository(pool);
  const result = await repository.save(settings);

  assert.equal(result.length, 2);
  assert.equal(pool.queries[0], 'BEGIN');
  assert.ok(pool.queries.some((query) => query.startsWith('CREATE TEMP TABLE line_type_settings_stage')));
  assert.ok(pool.queries.some((query) => query.startsWith('UPDATE line_types AS line_type')));
  assert.equal(pool.queries.some((query) => query.startsWith('DELETE FROM line_types')), false);
  assert.equal(pool.queries.at(-1), 'COMMIT');
  assert.equal(pool.released, true);
});

test('line type repository rejects unknown numeric codes', async () => {
  const pool = createPool({ unknownCodes: [99] });
  const repository = createLineTypesRepository(pool);

  await assert.rejects(repository.save(settings), /Unknown line type codes: 99/);
  assert.equal(pool.queries.at(-1), 'ROLLBACK');
  assert.equal(pool.released, true);
});
