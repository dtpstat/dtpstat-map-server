import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { publicDownloadFiles } from './public-download-name.js';

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

const LEGACY_METRIC_PROPERTIES = Object.freeze({
  lane_length_m: 'lanes_length',
  population: 'population',
  lane_m_per_1000: 'lanes_per_1k',
});

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
  if (column.kind === 'city') return row.name ?? row.short_name;
  if (column.kind === 'rank') return row.rank;
  if (column.kind === 'category') return row.category;
  if (column.kind === 'metric') {
    const legacyProperty = LEGACY_METRIC_PROPERTIES[column.metricKey];
    const value = row.metrics?.[column.metricKey] ??
      (legacyProperty ? row[legacyProperty] : undefined);
    return metricCsvValue(value, column);
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

async function removeObsoleteSnapshots(directory, keepNames) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  await Promise.allSettled(entries
    .filter((entry) =>
      entry.isFile() &&
      /\.(?:csv|geojson)$/i.test(entry.name) &&
      !keepNames.has(entry.name))
    .map((entry) => fs.unlink(path.join(directory, entry.name))));
}

/**
 * Materialize the public GeoJSON/CSV downloads as ordinary files. Both the
 * filesystem names and public URLs are derived from PROJECT_SETTINGS.
 *
 * @param {{
 *   repository: {
 *     exportGeoJson: () => Promise<object>,
 *     exportCsvRows: () => Promise<any[]>,
 *     exportCsvColumns?: () => Promise<any[]>
 *   },
 *   projectSettingsRepository?: { get: () => Promise<any> },
 *   directory: string
 * }} dependencies
 */
export function createPublicDownloadService({
  repository,
  projectSettingsRepository,
  directory,
}) {
  let files = publicDownloadFiles(undefined);

  return {
    directory,
    get geoJsonPath() { return path.join(directory, files.geoJsonFileName); },
    get csvPath() { return path.join(directory, files.csvFileName); },
    get files() { return { ...files }; },

    async refresh() {
      const [settings, geoJson, csvRows, csvColumns] = await Promise.all([
        projectSettingsRepository?.get?.() ?? Promise.resolve({}),
        repository.exportGeoJson(),
        repository.exportCsvRows(),
        repository.exportCsvColumns?.() ?? Promise.resolve(LEGACY_PUBLIC_CSV_COLUMNS),
      ]);
      files = publicDownloadFiles(settings?.publicDownloadName);
      const geoJsonPath = path.join(directory, files.geoJsonFileName);
      const csvPath = path.join(directory, files.csvFileName);
      const geoJsonText = `${JSON.stringify(geoJson)}\n`;
      const csvText = serializePublicCsv(csvRows, csvColumns);
      const token = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
      const geoJsonTempPath = path.join(directory, `.${files.geoJsonFileName}.${token}.tmp`);
      const csvTempPath = path.join(directory, `.${files.csvFileName}.${token}.tmp`);

      await fs.mkdir(directory, { recursive: true });
      try {
        await Promise.all([
          fs.writeFile(geoJsonTempPath, geoJsonText, 'utf8'),
          fs.writeFile(csvTempPath, csvText, 'utf8'),
        ]);
        await fs.rename(geoJsonTempPath, geoJsonPath);
        await fs.rename(csvTempPath, csvPath);
        await removeObsoleteSnapshots(
          directory,
          new Set([files.geoJsonFileName, files.csvFileName]),
        );
      } finally {
        await Promise.allSettled([
          fs.unlink(geoJsonTempPath),
          fs.unlink(csvTempPath),
        ]);
      }

      return {
        publicDownloadName: files.baseName,
        geoJsonFileName: files.geoJsonFileName,
        csvFileName: files.csvFileName,
        geoJsonUrl: files.geoJsonUrl,
        csvUrl: files.csvUrl,
        geoJsonBytes: Buffer.byteLength(geoJsonText),
        csvBytes: Buffer.byteLength(csvText),
        featureCount: Array.isArray(geoJson.features) ? geoJson.features.length : 0,
        cityCount: csvRows.length,
        csvColumns: Array.isArray(csvColumns) ? csvColumns.length : 0,
      };
    },
  };
}
