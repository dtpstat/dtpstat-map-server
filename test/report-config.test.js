import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_REPORT_CONFIG,
  ReportConfigValidationError,
  validateReportConfig,
} from '../src/data/report-config.js';

test('default bus-lane report configuration is valid', () => {
  const config = validateReportConfig(structuredClone(DEFAULT_REPORT_CONFIG));

  assert.equal(config.rank.metricKey, 'lane_m_per_1000');
  assert.equal(config.tableColumns.length, 5);
  assert.equal(config.csvColumns.length, 8);
  assert.equal(config.metrics.length, 3);
});

test('tram report can calculate separation ratio with a selected line-type group', () => {
  const config = validateReportConfig({
    metrics: [
      {
        key: 'network_length_m',
        name: 'Длина сети',
        source: {
          kind: 'aggregate',
          field: 'geometry.length_m',
          aggregate: 'sum',
          groupBy: 'none',
        },
        operations: [],
      },
      {
        key: 'population',
        name: 'Население',
        source: { kind: 'field', field: 'city.population' },
        operations: [],
      },
      {
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
      },
    ],
    tableColumns: [
      { kind: 'rank', title: '№' },
      { kind: 'city', title: 'город' },
      { kind: 'metric', metricKey: 'separation_ratio', title: 'доля обособления', scale: 100, decimals: 1 },
      { kind: 'metric', metricKey: 'network_length_m', title: 'длина сети (км)', scale: 0.001, decimals: 1 },
      { kind: 'metric', metricKey: 'population', title: 'население (тыс.чел)', scale: 0.001, decimals: 0 },
    ],
    csvColumns: [
      { kind: 'city', title: 'city' },
      { kind: 'metric', metricKey: 'separation_ratio', title: 'separation_percent', scale: 100, decimals: 1 },
      { kind: 'metric', metricKey: 'network_length_m', title: 'network_km', scale: 0.001, decimals: 2 },
    ],
    rank: { metricKey: 'separation_ratio', direction: 'desc' },
  }, {
    allowedLineTypeNames: ['Обособленные', 'Совмещённые'],
  });

  assert.equal(config.metrics[2].source.groupValue, 'Обособленные');
  assert.equal(config.tableColumns[2].scale, 100);
  assert.equal(config.rank.direction, 'desc');
});

test('report DSL rejects values outside server-owned catalogs', () => {
  const cases = [
    (config) => { config.metrics[0].source.field = 'geometry.secret_sql'; },
    (config) => { config.metrics[0].source.aggregate = 'string_agg'; },
    (config) => {
      config.metrics[0].operations.push({
        operator: 'execute',
        operand: { kind: 'constant', value: 1 },
      });
    },
    (config) => {
      config.metrics[0].operations.push({
        operator: 'multiply',
        operand: { kind: 'constant', value: 123.456 },
      });
    },
    (config) => { config.tableColumns[2].scale = 7; },
  ];

  for (const mutate of cases) {
    const config = structuredClone(DEFAULT_REPORT_CONFIG);
    mutate(config);
    assert.throws(
      () => validateReportConfig(config),
      ReportConfigValidationError,
    );
  }
});

test('line type group value must come from the current line type catalog', () => {
  const config = structuredClone(DEFAULT_REPORT_CONFIG);
  config.metrics[0].source.groupBy = 'line_type.name';
  config.metrics[0].source.groupValue = 'DROP TABLE cities';

  assert.throws(
    () => validateReportConfig(config, {
      allowedLineTypeNames: ['Обособленные', 'Совмещённые'],
    }),
    /must be selected from current line types/,
  );
});

test('table, CSV and rank cannot reference unknown metrics', () => {
  for (const mutate of [
    (config) => { config.tableColumns[2].metricKey = 'missing'; },
    (config) => { config.csvColumns[1].metricKey = 'missing'; },
    (config) => { config.rank.metricKey = 'missing'; },
  ]) {
    const config = structuredClone(DEFAULT_REPORT_CONFIG);
    mutate(config);
    assert.throws(() => validateReportConfig(config), /unknown metric/);
  }

  const duplicateHeader = structuredClone(DEFAULT_REPORT_CONFIG);
  duplicateHeader.csvColumns[1].title = duplicateHeader.csvColumns[0].title.toUpperCase();
  assert.throws(() => validateReportConfig(duplicateHeader), /Duplicate CSV header/);
});
