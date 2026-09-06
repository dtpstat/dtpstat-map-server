import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const CSV_COLUMNS = [
  ['short_name', 'short_name'],
  ['lanes_length', 'lanes_length'],
  ['population', 'population'],
  ['lanes_per_1K', 'lanes_per_1k'],
  ['minx', 'minx'],
  ['miny', 'miny'],
  ['maxx', 'maxx'],
  ['maxy', 'maxy'],
];

/** @param {unknown} value */
function csvValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** @param {any[]} rows */
export function serializePublicCsv(rows) {
  const lines = [CSV_COLUMNS.map(([header]) => header).join(',')];
  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map(([, property]) => csvValue(row[property])).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Materialize the public GeoJSON/CSV downloads as ordinary files. Both
 * payloads are fully calculated before either visible file is replaced.
 *
 * @param {{
 *   repository: { exportGeoJson: () => Promise<object>, exportCsvRows: () => Promise<any[]> },
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
      const [geoJson, csvRows] = await Promise.all([
        repository.exportGeoJson(),
        repository.exportCsvRows(),
      ]);
      const geoJsonText = `${JSON.stringify(geoJson)}\n`;
      const csvText = serializePublicCsv(csvRows);
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
      };
    },
  };
}
