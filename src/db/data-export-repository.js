import {
  createDataExportService,
} from '../application/data-transfer/export-service.js';
import {
  createDataExportStorageRepository,
} from './data-export-storage-repository.js';

/**
 * DB composition adapter for portable data export.
 *
 * @param {{
 *   query: (text: string, values?: unknown[]) => Promise<any>,
 *   connect?: () => Promise<any>
 * }} database
 * @param {{
 *   storage?: ReturnType<typeof createDataExportStorageRepository>
 * }} [dependencies]
 */
export function createDataExportRepository(
  database,
  dependencies = {},
) {
  return createDataExportService(database, {
    ...dependencies,
    storage:
      dependencies.storage ??
      createDataExportStorageRepository(),
  });
}
