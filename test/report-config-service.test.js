import assert from 'node:assert/strict';
import test from 'node:test';
import { compileReportMetricQuery } from '../src/db/report-config-service.js';

test('metric compiler uses server SQL fragments and parameters for selected group values', () => {
  const query = compileReportMetricQuery({
    key: 'separation_ratio',
    name: 'Доля обособления',
    source: {
      kind: 'aggregate',
      field: 'geometry.length_m',
      aggregate: 'sum',
      groupBy: 'line_type.name',
      groupValue: 'Обособленные',
    },
    operations: [
      {
        operator: 'divide',
        operand: {
          kind: 'aggregate',
          field: 'geometry.length_m',
          aggregate: 'sum',
          groupBy: 'none',
        },
      },
    ],
  });

  assert.match(query.text, /SUM\(geometry\.length_m::double precision\)/);
  assert.match(query.text, /LOWER\(BTRIM\(line_type\.name\)\)/);
  assert.match(query.text, /CASE WHEN .* = 0 THEN NULL ELSE/s);
  assert.doesNotMatch(query.text, /Обособленные/);
  assert.deepEqual(query.values, ['separation_ratio', 'Обособленные']);
});

test('metric compiler parameterizes constants instead of interpolating them as expressions', () => {
  const query = compileReportMetricQuery({
    key: 'per_1000',
    source: { kind: 'field', field: 'city.population' },
    operations: [
      {
        operator: 'multiply',
        operand: { kind: 'constant', value: 1000 },
      },
    ],
  });

  assert.match(query.text, /population\.population::double precision/);
  assert.match(query.text, /\$2::double precision/);
  assert.deepEqual(query.values, ['per_1000', 1000]);
});
