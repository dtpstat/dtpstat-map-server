import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileReportMetricQuery,
  compileReportRankQuery,
} from '../src/db/report-config-service.js';

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
        priority: 1,
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

test('metric compiler uses PostgreSQL percentile_cont for median geometry values', () => {
  const query = compileReportMetricQuery({
    key: 'median_length',
    source: {
      kind: 'aggregate',
      field: 'geometry.length_m',
      aggregate: 'median',
      groupBy: 'line_type.name',
      groupValue: 'Обособленные',
    },
    operations: [],
  });

  assert.match(
    query.text,
    /PERCENTILE_CONT\(0\.5\) WITHIN GROUP \(ORDER BY geometry\.length_m::double precision\)/,
  );
  assert.match(query.text, /FILTER \(\s*WHERE LOWER\(BTRIM\(line_type\.name\)\)/s);
  assert.deepEqual(query.values, ['median_length', 'Обособленные']);
});

test('metric compiler parameterizes constants instead of interpolating them as expressions', () => {
  const query = compileReportMetricQuery({
    key: 'per_1000',
    source: { kind: 'field', field: 'city.population' },
    operations: [
      {
        operator: 'multiply',
        priority: 1,
        operand: { kind: 'constant', value: 1000 },
      },
    ],
  });

  assert.match(query.text, /population\.population::double precision/);
  assert.match(query.text, /\$2::double precision/);
  assert.deepEqual(query.values, ['per_1000', 1000]);
});

test('metric compiler honors explicit precedence through RPN grouping', () => {
  const query = compileReportMetricQuery({
    key: 'grouped',
    source: { kind: 'field', field: 'city.population' },
    operations: [
      {
        operator: 'add',
        priority: 2,
        operand: { kind: 'constant', value: 10 },
      },
      {
        operator: 'multiply',
        priority: 1,
        operand: { kind: 'constant', value: 100 },
      },
      {
        operator: 'subtract',
        priority: 2,
        operand: { kind: 'constant', value: 1 },
      },
    ],
  });

  assert.match(
    query.text,
    /\(\(population\.population::double precision \+ \$2::double precision\) \* \(\$3::double precision - \$4::double precision\)\)/,
  );
  assert.deepEqual(query.values, ['grouped', 10, 100, 1]);
});

test('metric compiler can read previously materialized metric values', () => {
  const query = compileReportMetricQuery({
    key: 'per_capita',
    source: { kind: 'metric', metricKey: 'network_length_m' },
    operations: [
      {
        operator: 'divide',
        priority: 1,
        operand: { kind: 'metric', metricKey: 'population' },
      },
    ],
  });

  assert.match(query.text, /FROM city_report_values AS dependency_report/);
  assert.match(query.text, /jsonb_typeof\(dependency_report\.values/);
  assert.match(query.text, /dependency_report\.city_id = city\.id/);
  assert.deepEqual(query.values, ['per_capita', 'network_length_m', 'population']);
  assert.doesNotMatch(query.text, /network_length_m/);
  assert.doesNotMatch(query.text, /'population'/);
});

test('city area field is calculated from the OSM boundary geography in square metres', () => {
  const query = compileReportMetricQuery({
    key: 'city_area_m2',
    source: { kind: 'field', field: 'city.area_m2' },
    operations: [],
  });

  assert.match(query.text, /ST_Area\(city_boundary\.geom::geography\)::double precision/);
  assert.match(query.text, /FROM city_boundaries AS city_boundary/);
  assert.match(query.text, /city_boundary\.city_id = city\.id/);
  assert.match(query.text, /GROUP BY city\.id, population\.population/);
  assert.deepEqual(query.values, ['city_area_m2']);
});

test('rank compiler applies criteria sequentially and parameterizes secondary metric keys', () => {
  const query = compileReportRankQuery({
    sort: [
      { metricKey: 'primary_score', direction: 'desc' },
      { metricKey: 'network_length_m', direction: 'asc' },
      { metricKey: 'population', direction: 'desc' },
    ],
  });

  assert.match(query.text, /report\.rank_value DESC NULLS LAST/);
  assert.match(query.text, /report\.values -> \(\$1::text\)/);
  assert.match(query.text, /report\.values -> \(\$2::text\)/);
  assert.match(query.text, /\) ASC NULLS LAST/);
  assert.match(query.text, /\) DESC NULLS LAST/);
  assert.match(query.text, /city\.name ASC/);
  assert.match(query.text, /PARTITION BY COALESCE\(city\.is_large, FALSE\)/);
  assert.deepEqual(query.values, ['network_length_m', 'population']);
  assert.doesNotMatch(query.text, /network_length_m/);
  assert.doesNotMatch(query.text, /population'/);
});
