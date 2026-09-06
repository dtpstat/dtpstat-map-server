import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const LEGACY_PUBLIC_CSV_COLUMNS = Object.freeze([
  Object.freeze({ kind: 'city', title: 'short_name' }),
  Object.freeze({ kind: 'metric', metricKey: 'lane_length_m', title: 'lanes_length', scale: 1, decimals: null }),
  Object.freeze({ kind: 'metric', metricKey: 'population', title: 'population', scale: 1, decimals: null }),
  Object.freeze({ kind: 'metric', metricKey: 'lane_m_per_1000', title: 'lanes_per_1K', scale: 1, decimals: null }),
  Object.freeze({ kind: 'minx', title: 'minx' }),
  Object.freeze({ kind: 'miny', title: 'miny' }),
  Object.freeze({ kind: 'maxx', title: 'maxx' }),
  Object.freeze({ kind: 'maxy', title: 'maxy' }),
]);

/** @param {unknown} value */
function csvValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** @param {unknown} value @param {{ scale?: number, decimals?: number | null }} column */
function metricCsvValue(value, column) {
  if (value === null || value === undefined) return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const scaled = number * (column.scale ?? 1);
  return column.decimals === null || column.decimals === undefined
    ? String(scaled)
    : scaled.toFixed(column.decimals);
}

/** @param {any} row @param {any} column */
function columnValue(row, column) {
  if (column.kind === 'city') return row.name;
  if (column.kind === 'rank') return row.rank;
  if (column.kind === 'category') return row.category;
  if (column.kind === 'metric') {
    return metricCsvValue(row.metrics?.[column.metricKey], column);
  }
  if (['minx', 'miny', 'maxx', 'maxy'].includes(column.kind)) {
    return row[column.kind];
  }
  return '';
}

/** @param {any[]} rows @param {any[]} [columns] */
export function serializePublicCsv(rows, columns = LEGACY_PUBLIC_CSV_COLUMNS) {
  const effectiveColumns = Array.isArray(columns) && columns.length > 0
    ? columns
    : LEGACY_PUBLIC_CSV_COLUMNS;
  const lines = [effectiveColumns.map((column) => csvValue(column.title)).join(',')];
  for (const row of rows) {
    lines.push(
      effectiveColumns.map((column) => csvValue(columnValue(row, column))).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Materialize the public GeoJSON/CSV downloads as ordinary files. Both
 * payloads are fully calculated before either visible file is replaced.
 *
 * @param {{
 *   repository: {
 *     exportGeoJson: () => Promise<object>,
 *     exportCsvRows: () => Promise<any[]>,
 *     exportCsvColumns?: () => Promise<any[]>
 *   },
 *   directory: string
 * }} dependencies
 */
export function createPublicDownloadService({ repository, directory }) {
  const geoJsonPath = path.join(directory, 'bus-lanes.geojson');
  const csvPath = path.join(directory, 'bus-lanes.csv');

  return {
    directory,
    geoJsonPath,
    csvPath,

    async refresh() {
      const [geoJson, csvRows, csvColumns] = await Promise.all([
        repository.exportGeoJson(),
        repository.exportCsvRows(),
        repository.exportCsvColumns?.() ?? Promise.resolve(LEGACY_PUBLIC_CSV_COLUMNS),
      ]);
      const geoJsonText = `${JSON.stringify(geoJson)}\n`;
      const csvText = serializePublicCsv(csvRows, csvColumns);
      const token = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
      const geoJsonTempPath = path.join(directory, `.bus-lanes.geojson.${token}.tmp`);
      const csvTempPath = path.join(directory, `.bus-lanes.csv.${token}.tmp`);

      await fs.mkdir(directory, { recursive: true });
      try {
        await Promise.all([
          fs.writeFile(geoJsonTempPath, geoJsonText, 'utf8'),
          fs.writeFile(csvTempPath, csvText, 'utf8'),
        ]);
        await fs.rename(geoJsonTempPath, geoJsonPath);
        await fs.rename(csvTempPath, csvPath);
      } finally {
        await Promise.allSettled([
          fs.unlink(geoJsonTempPath),
          fs.unlink(csvTempPath),
        ]);
      }

      return {
        geoJsonBytes: Buffer.byteLength(geoJsonText),
        csvBytes: Buffer.byteLength(csvText),
        featureCount: Array.isArray(geoJson.features) ? geoJson.features.length : 0,
        cityCount: csvRows.length,
        csvColumns: Array.isArray(csvColumns) ? csvColumns.length : 0,
      };
    },
  };
}
