const LEGACY_PUBLIC_CSV_COLUMNS = Object.freeze([
  Object.freeze({
    kind: 'city',
    title: 'short_name',
  }),
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
]);

const LEGACY_METRIC_PROPERTIES = Object.freeze({
  lane_length_m: 'lanes_length',
  population: 'population',
  lane_m_per_1000: 'lanes_per_1k',
});

/** @param {unknown} value */
function csvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * @param {unknown} value
 * @param {{ scale?: number, decimals?: number | null }} column
 */
function metricCsvValue(value, column) {
  if (value === null || value === undefined) {
    return '';
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }

  const scaled = number * (column.scale ?? 1);
  return (
    column.decimals === null ||
    column.decimals === undefined
  )
    ? String(scaled)
    : scaled.toFixed(column.decimals);
}

/** @param {any} row @param {any} column */
function columnValue(row, column) {
  if (column.kind === 'city') {
    return row.name ?? row.short_name;
  }
  if (column.kind === 'rank') {
    return row.rank;
  }
  if (column.kind === 'category') {
    return row.category;
  }
  if (column.kind === 'metric') {
    const legacyProperty =
      LEGACY_METRIC_PROPERTIES[column.metricKey];
    const value =
      row.metrics?.[column.metricKey] ??
      (
        legacyProperty
          ? row[legacyProperty]
          : undefined
      );

    return metricCsvValue(value, column);
  }
  if (
    ['minx', 'miny', 'maxx', 'maxy']
      .includes(column.kind)
  ) {
    return row[column.kind];
  }
  return '';
}

/**
 * Serialize materialized public report rows into the configured CSV shape.
 *
 * @param {any[]} rows
 * @param {any[]} [columns]
 */
export function serializePublicCsv(
  rows,
  columns = LEGACY_PUBLIC_CSV_COLUMNS,
) {
  const effectiveColumns =
    Array.isArray(columns) &&
    columns.length > 0
      ? columns
      : LEGACY_PUBLIC_CSV_COLUMNS;

  const lines = [
    effectiveColumns
      .map((column) => csvValue(column.title))
      .join(','),
  ];

  for (const row of rows) {
    lines.push(
      effectiveColumns
        .map(
          (column) =>
            csvValue(
              columnValue(row, column),
            ),
        )
        .join(','),
    );
  }

  return `${lines.join('\n')}\n`;
}

export function defaultPublicCsvColumns() {
  return LEGACY_PUBLIC_CSV_COLUMNS;
}
