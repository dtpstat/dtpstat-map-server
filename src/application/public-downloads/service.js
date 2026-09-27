import path from 'node:path';
import {
  publicDownloadFiles,
} from '../../modules/project/public-download-policy.js';
import {
  replaceAtomicSnapshotFiles,
} from '../../shared/files/atomic-snapshot.js';
import {
  defaultPublicCsvColumns,
  serializePublicCsv,
} from '../../shared/streaming/csv.js';

export { serializePublicCsv };

/**
 * Materialize the public GeoJSON/CSV downloads as ordinary files. Both the
 * filesystem names and public URLs are derived from project settings.
 *
 * @param {{
 *   repository: {
 *     exportGeoJson: () => Promise<object>,
 *     exportCsvRows: () => Promise<any[]>,
 *     exportCsvColumns?: () => Promise<any[]>
 *   },
 *   projectSettingsRepository?: { get: () => Promise<any> },
 *   directory: string,
 *   replaceFiles?: typeof replaceAtomicSnapshotFiles
 * }} dependencies
 */
export function createPublicDownloadService({
  repository,
  projectSettingsRepository,
  directory,
  replaceFiles = replaceAtomicSnapshotFiles,
}) {
  let files = publicDownloadFiles(undefined);

  return {
    directory,

    get geoJsonPath() {
      return path.join(
        directory,
        files.geoJsonFileName,
      );
    },

    get csvPath() {
      return path.join(
        directory,
        files.csvFileName,
      );
    },

    get files() {
      return { ...files };
    },

    async refresh() {
      const [
        settings,
        geoJson,
        csvRows,
        csvColumns,
      ] = await Promise.all([
        projectSettingsRepository?.get?.() ??
          Promise.resolve({}),
        repository.exportGeoJson(),
        repository.exportCsvRows(),
        repository.exportCsvColumns?.() ??
          Promise.resolve(
            defaultPublicCsvColumns(),
          ),
      ]);

      files = publicDownloadFiles(
        settings?.publicDownloadName,
      );

      const geoJsonText =
        `${JSON.stringify(geoJson)}\n`;
      const csvText =
        serializePublicCsv(
          csvRows,
          csvColumns,
        );

      await replaceFiles({
        directory,
        files: [
          {
            name: files.geoJsonFileName,
            content: geoJsonText,
            encoding: 'utf8',
          },
          {
            name: files.csvFileName,
            content: csvText,
            encoding: 'utf8',
          },
        ],
        obsoletePattern:
          /\.(?:csv|geojson)$/i,
      });

      return {
        publicDownloadName: files.baseName,
        geoJsonFileName:
          files.geoJsonFileName,
        csvFileName:
          files.csvFileName,
        geoJsonUrl:
          files.geoJsonUrl,
        csvUrl:
          files.csvUrl,
        geoJsonBytes:
          Buffer.byteLength(geoJsonText),
        csvBytes:
          Buffer.byteLength(csvText),
        featureCount:
          Array.isArray(geoJson.features)
            ? geoJson.features.length
            : 0,
        cityCount: csvRows.length,
        csvColumns:
          Array.isArray(csvColumns)
            ? csvColumns.length
            : 0,
      };
    },
  };
}
