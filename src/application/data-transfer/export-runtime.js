import {
  createDataExportService,
} from './export-service.js';
import {
  createDataExportStorageRepository,
} from '../../db/data-export-storage-repository.js';

/**
 * Compose portable export framing with the SQL/cursor storage implementation.
 */
export function createDataExportRuntime(
  database,
  dependencies = {},
) {
  return createDataExportService(
    database,
    {
      ...dependencies,
      storage:
        dependencies.storage ??
        createDataExportStorageRepository(),
    },
  );
}
