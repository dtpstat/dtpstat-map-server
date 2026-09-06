import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_REPORT_CONFIG,
  orderReportMetricsByDependencies,
  REPORT_CONFIG_CATALOG,
  reportMetricToRpn,
  ReportConfigValidationError,
  validateReportConfig,
} from '../src/data/report-config.js';

test('default bus-lane report configuration is valid', () => {
  const config = validateReportConfig(structuredClone(DEFAULT_REPORT_CONFIG));

  assert.equal(config.rank.metricKey, 'lane_m_per_1000');
  assert.equal(config.tableColumns.length, 5);
  assert.equal(config.csvColumns.length, 8);
  assert.equal(config.metrics.length, 3);
  assert.deepEqual(
    config.metrics[2].operations.map((operation) => operation.priority),
    [1, 1],
  );
  assert.deepEqual(config.tableColumns[2].formatRules, []);
});

test('city area and median geometry aggregation are available in the catalog', () => {
  const area = REPORT_CONFIG_CATALOG.fields.find((field) => field.key === 'city.area_m2');
  assert.deepEqual(area?.sourceKinds, ['field']);
  assert.match(area?.label ?? '', /м²/);
  assert.ok(REPORT_CONFIG_CATALOG.operandKinds.some((kind) => kind.key === 'metric'));
  assert.ok(REPORT_CONFIG_CATALOG.aggregates.some((aggregate) => aggregate.key === 'median'));

  for (const key of ['geometry.length_m', 'geometry.lane_length_m', 'geometry.lanes']) {
    assert.ok(REPORT_CONFIG_CATALOG.fields.find((field) => field.key === key)?.aggregates.includes('median'));
  }
  assert.equal(
    REPORT_CONFIG_CATALOG.fields.find((field) => field.key === 'geometry.id')?.aggregates.includes('median'),
    false,
  );
});

test('legacy report operations without explicit priority keep left-to-right semantics', () => {
  const config = structuredClone(DEFAULT_REPORT_CONFIG);
  delete config.metrics[2].operations[0].priority;
  delete config.metrics[2].operations[1].priority;

  const normalized = validateReportConfig(config);
  assert.deepEqual(
    normalized.metrics[2].operations.map((operation) => operation.priority),
    [1, 1],
  );

  const operators = reportMetricToRpn(normalized.metrics[2])
    .filter((token) => token.kind === 'operator')
    .map((token) => token.operator);
  assert.deepEqual(operators, ['divide', 'multiply']);
});

test('explicit priorities can express nested parentheses through RPN', () => {
  const metric = {
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
  };

  const rpn = reportMetricToRpn(metric);
  assert.deepEqual(
    rpn.map((token) => token.kind === 'operator' ? token.operator : 'operand'),
    ['operand', 'operand', 'add', 'operand', 'operand', 'subtract', 'multiply'],
  );
});

test('metrics can reference other metrics and are ordered by dependencies', () => {
  const config = structuredClone(DEFAULT_REPORT_CONFIG);
  const laneLength = config.metrics[0];
  const population = config.metrics[1];
  const derived = config.metrics[2];
  derived.source = { kind: 'metric', metricKey: 'lane_length_m' };
  derived.operations[0].operand = { kind: 'metric', metricKey: 'population' };
  config.metrics = [derived, population, laneLength];

  const normalized = validateReportConfig(config);
  assert.deepEqual(normalized.metrics[0].source, {
    kind: 'metric',
    metricKey: 'lane_length_m',
  });
  assert.deepEqual(
    orderReportMetricsByDependencies(normalized.metrics).map((metric) => metric.key),
    ['lane_length_m', 'population', 'lane_m_per_1000'],
  );
});

test('metric references reject missing targets and dependency cycles', () => {
  const missing = structuredClone(DEFAULT_REPORT_CONFIG);
  missing.metrics[2].source = { kind: 'metric', metricKey: 'missing_metric' };
  assert.throws(
    () => validateReportConfig(missing),
    /references unknown metric missing_metric/,
  );

  const cyclic = structuredClone(DEFAULT_REPORT_CONFIG);
  cyclic.metrics[0].source = { kind: 'metric', metricKey: 'lane_m_per_1000' };
  cyclic.metrics[2].source = { kind: 'metric', metricKey: 'lane_length_m' };
  assert.throws(
    () => validateReportConfig(cyclic),
    /Metric dependency cycle/,
  );
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
            priority: 1,
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
  assert.equal(config.metrics[2].operations[0].priority, 1);
  assert.equal(config.tableColumns[2].scale, 100);
  assert.equal(config.rank.direction, 'desc');
});

test('public numeric columns normalize safe conditional formatting rules', () => {
  const config = structuredClone(DEFAULT_REPORT_CONFIG);
  config.tableColumns[2].formatRules = [
    {
      min: 10,
      max: 25.5,
      bold: true,
      italic: true,
      underline: false,
      strike: true,
      color: '#A1B2C3',
      fontSizeStep: 2,
    },
    {
      min: null,
      max: 9.999,
      color: null,
      fontSizeStep: -1,
    },
  ];
  const normalized = validateReportConfig(config);

  assert.deepEqual(normalized.tableColumns[2].formatRules[0], {
    min: 10,
    max: 25.5,
    bold: true,
    italic: true,
    underline: false,
    strike: true,
    color: '#a1b2c3',
    fontSizeStep: 2,
  });
  assert.equal(normalized.tableColumns[2].formatRules[1].bold, false);
  assert.equal(normalized.tableColumns[2].formatRules[1].fontSizeStep, -1);
  assert.deepEqual(REPORT_CONFIG_CATALOG.formatFontSizes.map((item) => item.value), [-2, -1, 0, 1, 2]);
});

test('conditional formatting rejects invalid or empty ranges, colors, sizes and text columns', () => {
  const cases = [
    (config) => {
      config.tableColumns[2].formatRules = [{ min: 20, max: 10, fontSizeStep: 0 }];
    },
    (config) => {
      config.tableColumns[2].formatRules = [{ min: 10, max: 10, fontSizeStep: 0 }];
    },
    (config) => {
      config.tableColumns[2].formatRules = [{ min: null, max: null, color: 'red', fontSizeStep: 0 }];
    },
    (config) => {
      config.tableColumns[2].formatRules = [{ min: null, max: null, fontSizeStep: 3 }];
    },
    (config) => {
      config.tableColumns[1].formatRules = [{ min: 1, max: 2, fontSizeStep: 0 }];
    },
    (config) => {
      config.tableColumns[2].formatRules = Array.from({ length: 9 }, () => ({
        min: null,
        max: null,
        fontSizeStep: 0,
      }));
    },
  ];

  for (const mutate of cases) {
    const config = structuredClone(DEFAULT_REPORT_CONFIG);
    mutate(config);
    assert.throws(() => validateReportConfig(config), ReportConfigValidationError);
  }
});

test('report DSL rejects values outside server-owned catalogs', () => {
  const cases = [
    (config) => { config.metrics[0].source.field = 'geometry.secret_sql'; },
    (config) => { config.metrics[0].source.aggregate = 'string_agg'; },
    (config) => {
      config.metrics[0].operations.push({
        operator: 'execute',
        priority: 1,
        operand: { kind: 'constant', value: 1 },
      });
    },
    (config) => {
      config.metrics[0].operations.push({
        operator: 'multiply',
        priority: 1,
        operand: { kind: 'constant', value: 123.456 },
      });
    },
    (config) => {
      config.metrics[0].operations.push({
        operator: 'multiply',
        priority: 99,
        operand: { kind: 'constant', value: 1 },
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
