const MAX_METRICS = 20;
const MAX_OPERATIONS = 12;
const MAX_TABLE_COLUMNS = 12;
const MAX_CSV_COLUMNS = 24;

export class ReportConfigValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReportConfigValidationError';
  }
}

export const REPORT_FIELDS = Object.freeze([
  Object.freeze({
    key: 'city.population',
    label: 'Население города',
    sourceKinds: ['field'],
    aggregates: [],
  }),
  Object.freeze({
    key: 'geometry.length_m',
    label: 'Длина геометрии, м',
    sourceKinds: ['aggregate'],
    aggregates: ['sum', 'avg', 'min', 'max'],
  }),
  Object.freeze({
    key: 'geometry.lane_length_m',
    label: 'Длина × коэффициент/полосы, м',
    sourceKinds: ['aggregate'],
    aggregates: ['sum', 'avg', 'min', 'max'],
  }),
  Object.freeze({
    key: 'geometry.lanes',
    label: 'Коэффициент / количество полос',
    sourceKinds: ['aggregate'],
    aggregates: ['sum', 'avg', 'min', 'max'],
  }),
  Object.freeze({
    key: 'geometry.id',
    label: 'Количество геометрий',
    sourceKinds: ['aggregate'],
    aggregates: ['count'],
  }),
]);

export const REPORT_AGGREGATES = Object.freeze([
  Object.freeze({ key: 'sum', label: 'Сумма' }),
  Object.freeze({ key: 'avg', label: 'Среднее' }),
  Object.freeze({ key: 'min', label: 'Минимум' }),
  Object.freeze({ key: 'max', label: 'Максимум' }),
  Object.freeze({ key: 'count', label: 'Количество' }),
]);

export const REPORT_OPERATORS = Object.freeze([
  Object.freeze({ key: 'add', label: '+' }),
  Object.freeze({ key: 'subtract', label: '−' }),
  Object.freeze({ key: 'multiply', label: '×' }),
  Object.freeze({ key: 'divide', label: '÷' }),
  Object.freeze({ key: 'percent', label: '% от' }),
]);

export const REPORT_PRECEDENCE_LEVELS = Object.freeze(
  Array.from({ length: MAX_OPERATIONS }, (_unused, index) => {
    const value = index + 1;
    let label = `Уровень ${value}`;
    if (value === 1) label += ' — обычный';
    if (value === MAX_OPERATIONS) label += ' — самый высокий';
    return Object.freeze({ value, label });
  }),
);

export const REPORT_GROUPINGS = Object.freeze([
  Object.freeze({ key: 'none', label: 'Без группировки' }),
  Object.freeze({ key: 'line_type.name', label: 'По бизнес-типу линии' }),
]);

export const REPORT_CONSTANTS = Object.freeze([
  0.001,
  0.01,
  0.1,
  1,
  10,
  100,
  1000,
  1000000,
]);

export const REPORT_SCALES = Object.freeze([
  Object.freeze({ value: 0.001, label: '÷ 1000' }),
  Object.freeze({ value: 0.01, label: '× 0.01' }),
  Object.freeze({ value: 0.1, label: '× 0.1' }),
  Object.freeze({ value: 1, label: 'без масштаба' }),
  Object.freeze({ value: 10, label: '× 10' }),
  Object.freeze({ value: 100, label: '× 100' }),
  Object.freeze({ value: 1000, label: '× 1000' }),
]);

export const REPORT_DECIMALS = Object.freeze([null, 0, 1, 2, 3, 4, 6]);

export const REPORT_TABLE_COLUMN_KINDS = Object.freeze([
  Object.freeze({ key: 'rank', label: '№ / место' }),
  Object.freeze({ key: 'city', label: 'Город' }),
  Object.freeze({ key: 'metric', label: 'Расчётная метрика' }),
]);

export const REPORT_CSV_COLUMN_KINDS = Object.freeze([
  ...REPORT_TABLE_COLUMN_KINDS,
  Object.freeze({ key: 'category', label: 'Категория города' }),
  Object.freeze({ key: 'minx', label: 'Граница: min longitude' }),
  Object.freeze({ key: 'miny', label: 'Граница: min latitude' }),
  Object.freeze({ key: 'maxx', label: 'Граница: max longitude' }),
  Object.freeze({ key: 'maxy', label: 'Граница: max latitude' }),
]);

export const DEFAULT_REPORT_CONFIG = Object.freeze({
  metrics: Object.freeze([
    Object.freeze({
      key: 'lane_length_m',
      name: 'Длина ВП',
      source: Object.freeze({
        kind: 'aggregate',
        field: 'geometry.lane_length_m',
        aggregate: 'sum',
        groupBy: 'none',
      }),
      operations: Object.freeze([]),
    }),
    Object.freeze({
      key: 'population',
      name: 'Население',
      source: Object.freeze({
        kind: 'field',
        field: 'city.population',
      }),
      operations: Object.freeze([]),
    }),
    Object.freeze({
      key: 'lane_m_per_1000',
      name: 'ВП на 1000 жителей',
      source: Object.freeze({
        kind: 'aggregate',
        field: 'geometry.lane_length_m',
        aggregate: 'sum',
        groupBy: 'none',
      }),
      operations: Object.freeze([
        Object.freeze({
          operator: 'divide',
          priority: 1,
          operand: Object.freeze({ kind: 'field', field: 'city.population' }),
        }),
        Object.freeze({
          operator: 'multiply',
          priority: 1,
          operand: Object.freeze({ kind: 'constant', value: 1000 }),
        }),
      ]),
    }),
  ]),
  tableColumns: Object.freeze([
    Object.freeze({ kind: 'rank', title: '№' }),
    Object.freeze({ kind: 'city', title: 'город' }),
    Object.freeze({
      kind: 'metric',
      metricKey: 'lane_length_m',
      title: 'длина ВП (км)',
      scale: 0.001,
      decimals: 1,
    }),
    Object.freeze({
      kind: 'metric',
      metricKey: 'population',
      title: 'жители (тыс.)',
      scale: 0.001,
      decimals: 0,
    }),
    Object.freeze({
      kind: 'metric',
      metricKey: 'lane_m_per_1000',
      title: 'ВП (м/1000 чел.)',
      scale: 1,
      decimals: 1,
    }),
  ]),
  csvColumns: Object.freeze([
    Object.freeze({ kind: 'city', title: 'short_name' }),
    Object.freeze({
      kind: 'metric',
      metricKey: 'lane_length_m',
      title: 'lanes_length',
      scale: 1,
      decimals: null,
    }),
    Object.freeze({
      kind: 'metric',
      metricKey: 'population',
      title: 'population',
      scale: 1,
      decimals: null,
    }),
    Object.freeze({
      kind: 'metric',
      metricKey: 'lane_m_per_1000',
      title: 'lanes_per_1K',
      scale: 1,
      decimals: null,
    }),
    Object.freeze({ kind: 'minx', title: 'minx' }),
    Object.freeze({ kind: 'miny', title: 'miny' }),
    Object.freeze({ kind: 'maxx', title: 'maxx' }),
    Object.freeze({ kind: 'maxy', title: 'maxy' }),
  ]),
  rank: Object.freeze({ metricKey: 'lane_m_per_1000', direction: 'desc' }),
  updatedAt: null,
});

const FIELD_MAP = new Map(REPORT_FIELDS.map((field) => [field.key, field]));
const OPERATOR_KEYS = new Set(REPORT_OPERATORS.map((operator) => operator.key));
const PRECEDENCE_KEYS = new Set(REPORT_PRECEDENCE_LEVELS.map((level) => String(level.value)));
const GROUPING_KEYS = new Set(REPORT_GROUPINGS.map((grouping) => grouping.key));
const TABLE_KIND_KEYS = new Set(REPORT_TABLE_COLUMN_KINDS.map((kind) => kind.key));
const CSV_KIND_KEYS = new Set(REPORT_CSV_COLUMN_KINDS.map((kind) => kind.key));
const CONSTANT_KEYS = new Set(REPORT_CONSTANTS.map(String));
const SCALE_KEYS = new Set(REPORT_SCALES.map((scale) => String(scale.value)));
const DECIMAL_KEYS = new Set(REPORT_DECIMALS.map(String));

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReportConfigValidationError(`${label} must be an object`);
  }
  return value;
}

function text(value, label, max = 120) {
  if (typeof value !== 'string') {
    throw new ReportConfigValidationError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new ReportConfigValidationError(`${label} must contain 1-${max} characters`);
  }
  return normalized;
}

function metricKey(value, label = 'metric key') {
  const normalized = text(value, label, 64);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) {
    throw new ReportConfigValidationError(`${label} has an invalid generated identifier`);
  }
  return normalized;
}

function normalizeConstant(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !CONSTANT_KEYS.has(String(value))) {
    throw new ReportConfigValidationError(`${label} must be selected from the constant catalog`);
  }
  return value;
}

function normalizePriority(value, label) {
  const priority = value === undefined ? 1 : value;
  if (!Number.isInteger(priority) || !PRECEDENCE_KEYS.has(String(priority))) {
    throw new ReportConfigValidationError(`${label} must be selected from the precedence catalog`);
  }
  return priority;
}

function normalizeOperand(value, label, { allowConstant = true, allowedLineTypeNames } = {}) {
  const source = object(value, label);
  const kind = text(source.kind, `${label}.kind`, 20);

  if (kind === 'constant') {
    if (!allowConstant) {
      throw new ReportConfigValidationError(`${label} cannot be a constant`);
    }
    return { kind, value: normalizeConstant(source.value, `${label}.value`) };
  }

  const field = text(source.field, `${label}.field`, 64);
  const fieldDefinition = FIELD_MAP.get(field);
  if (!fieldDefinition || !fieldDefinition.sourceKinds.includes(kind)) {
    throw new ReportConfigValidationError(`${label}.field is not allowed for ${kind}`);
  }

  if (kind === 'field') return { kind, field };
  if (kind !== 'aggregate') {
    throw new ReportConfigValidationError(`${label}.kind is not supported`);
  }

  const aggregate = text(source.aggregate, `${label}.aggregate`, 20);
  if (!fieldDefinition.aggregates.includes(aggregate)) {
    throw new ReportConfigValidationError(`${label}.aggregate is not allowed for ${field}`);
  }
  const groupBy = source.groupBy === undefined
    ? 'none'
    : text(source.groupBy, `${label}.groupBy`, 40);
  if (!GROUPING_KEYS.has(groupBy)) {
    throw new ReportConfigValidationError(`${label}.groupBy is not allowed`);
  }

  const normalized = { kind, field, aggregate, groupBy };
  if (groupBy === 'line_type.name') {
    const groupValue = text(source.groupValue, `${label}.groupValue`, 160);
    if (allowedLineTypeNames && !allowedLineTypeNames.has(groupValue.toLocaleLowerCase('ru-RU'))) {
      throw new ReportConfigValidationError(`${label}.groupValue must be selected from current line types`);
    }
    normalized.groupValue = groupValue;
  }
  return normalized;
}

function normalizeMetric(value, index, options) {
  const metric = object(value, `metrics[${index}]`);
  const operations = Array.isArray(metric.operations) ? metric.operations : [];
  if (operations.length > MAX_OPERATIONS) {
    throw new ReportConfigValidationError(`metrics[${index}] has too many arithmetic operations`);
  }
  return {
    key: metricKey(metric.key, `metrics[${index}].key`),
    name: text(metric.name, `metrics[${index}].name`, 100),
    source: normalizeOperand(metric.source, `metrics[${index}].source`, {
      ...options,
      allowConstant: false,
    }),
    operations: operations.map((item, operationIndex) => {
      const operation = object(item, `metrics[${index}].operations[${operationIndex}]`);
      const operator = text(
        operation.operator,
        `metrics[${index}].operations[${operationIndex}].operator`,
        20,
      );
      if (!OPERATOR_KEYS.has(operator)) {
        throw new ReportConfigValidationError(`Arithmetic operator ${operator} is not allowed`);
      }
      return {
        operator,
        priority: normalizePriority(
          operation.priority,
          `metrics[${index}].operations[${operationIndex}].priority`,
        ),
        operand: normalizeOperand(
          operation.operand,
          `metrics[${index}].operations[${operationIndex}].operand`,
          options,
        ),
      };
    }),
  };
}

/**
 * Convert the linear metric editor representation into Reverse Polish
 * Notation. Higher numeric priority executes first; equal priorities are
 * left-associative. Existing configurations without priority therefore keep
 * their historic strict left-to-right semantics because every operation
 * normalizes to priority 1.
 *
 * @param {{ source: object, operations?: Array<{ operator: string, priority?: number, operand: object }> }} metric
 */
export function reportMetricToRpn(metric) {
  const output = [{ kind: 'operand', operand: metric.source }];
  const operators = [];

  for (const operation of metric.operations ?? []) {
    const current = {
      kind: 'operator',
      operator: operation.operator,
      priority: Number.isInteger(operation.priority) ? operation.priority : 1,
    };
    while (
      operators.length > 0 &&
      operators[operators.length - 1].priority >= current.priority
    ) {
      output.push(operators.pop());
    }
    operators.push(current);
    output.push({ kind: 'operand', operand: operation.operand });
  }

  while (operators.length > 0) output.push(operators.pop());
  return output;
}

function normalizeScale(value, label) {
  const scale = value === undefined ? 1 : value;
  if (typeof scale !== 'number' || !SCALE_KEYS.has(String(scale))) {
    throw new ReportConfigValidationError(`${label} must be selected from the scale catalog`);
  }
  return scale;
}

function normalizeDecimals(value, label) {
  const decimals = value === undefined ? null : value;
  if (!DECIMAL_KEYS.has(String(decimals))) {
    throw new ReportConfigValidationError(`${label} must be selected from the precision catalog`);
  }
  return decimals;
}

function normalizeColumn(value, index, metricKeys, allowedKinds, label) {
  const column = object(value, `${label}[${index}]`);
  const kind = text(column.kind, `${label}[${index}].kind`, 20);
  if (!allowedKinds.has(kind)) {
    throw new ReportConfigValidationError(`${label}[${index}].kind is not allowed`);
  }
  const normalized = {
    kind,
    title: text(column.title, `${label}[${index}].title`, 100),
  };
  if (kind === 'metric') {
    const key = metricKey(column.metricKey, `${label}[${index}].metricKey`);
    if (!metricKeys.has(key)) {
      throw new ReportConfigValidationError(`${label}[${index}] references unknown metric ${key}`);
    }
    normalized.metricKey = key;
    normalized.scale = normalizeScale(column.scale, `${label}[${index}].scale`);
    normalized.decimals = normalizeDecimals(column.decimals, `${label}[${index}].decimals`);
  }
  return normalized;
}

export function validateReportConfig(payload, options = {}) {
  const input = object(payload, 'report config');
  if (!Array.isArray(input.metrics) || input.metrics.length === 0 || input.metrics.length > MAX_METRICS) {
    throw new ReportConfigValidationError(`metrics must contain 1-${MAX_METRICS} items`);
  }
  const allowedLineTypeNames = options.allowedLineTypeNames
    ? new Set([...options.allowedLineTypeNames].map((name) => String(name).trim().toLocaleLowerCase('ru-RU')))
    : null;
  const metrics = input.metrics.map((metric, index) =>
    normalizeMetric(metric, index, { allowedLineTypeNames }));
  const metricKeys = new Set();
  for (const metric of metrics) {
    if (metricKeys.has(metric.key)) {
      throw new ReportConfigValidationError(`Duplicate metric key: ${metric.key}`);
    }
    metricKeys.add(metric.key);
  }

  if (!Array.isArray(input.tableColumns) || input.tableColumns.length === 0 || input.tableColumns.length > MAX_TABLE_COLUMNS) {
    throw new ReportConfigValidationError(`tableColumns must contain 1-${MAX_TABLE_COLUMNS} items`);
  }
  const tableColumns = input.tableColumns.map((column, index) =>
    normalizeColumn(column, index, metricKeys, TABLE_KIND_KEYS, 'tableColumns'));
  if (!tableColumns.some((column) => column.kind === 'city')) {
    throw new ReportConfigValidationError('tableColumns must contain the city column');
  }

  if (!Array.isArray(input.csvColumns) || input.csvColumns.length === 0 || input.csvColumns.length > MAX_CSV_COLUMNS) {
    throw new ReportConfigValidationError(`csvColumns must contain 1-${MAX_CSV_COLUMNS} items`);
  }
  const csvColumns = input.csvColumns.map((column, index) =>
    normalizeColumn(column, index, metricKeys, CSV_KIND_KEYS, 'csvColumns'));
  const csvHeaders = new Set();
  for (const column of csvColumns) {
    const normalizedHeader = column.title.toLocaleLowerCase('ru-RU');
    if (csvHeaders.has(normalizedHeader)) {
      throw new ReportConfigValidationError(`Duplicate CSV header: ${column.title}`);
    }
    csvHeaders.add(normalizedHeader);
  }

  const rankInput = object(input.rank, 'rank');
  const rankMetricKey = metricKey(rankInput.metricKey, 'rank.metricKey');
  if (!metricKeys.has(rankMetricKey)) {
    throw new ReportConfigValidationError(`rank.metricKey references unknown metric ${rankMetricKey}`);
  }
  const direction = text(rankInput.direction, 'rank.direction', 4);
  if (!['asc', 'desc'].includes(direction)) {
    throw new ReportConfigValidationError('rank.direction must be asc or desc');
  }

  return {
    metrics,
    tableColumns,
    csvColumns,
    rank: { metricKey: rankMetricKey, direction },
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : null,
  };
}

export function publicReportConfig(config) {
  const normalized = validateReportConfig(config);
  return {
    tableColumns: normalized.tableColumns,
    rank: normalized.rank,
    updatedAt: normalized.updatedAt,
  };
}

export const REPORT_CONFIG_CATALOG = Object.freeze({
  fields: REPORT_FIELDS,
  aggregates: REPORT_AGGREGATES,
  operators: REPORT_OPERATORS,
  precedenceLevels: REPORT_PRECEDENCE_LEVELS,
  groupings: REPORT_GROUPINGS,
  constants: REPORT_CONSTANTS,
  scales: REPORT_SCALES,
  decimals: REPORT_DECIMALS,
  tableColumnKinds: REPORT_TABLE_COLUMN_KINDS,
  csvColumnKinds: REPORT_CSV_COLUMN_KINDS,
});