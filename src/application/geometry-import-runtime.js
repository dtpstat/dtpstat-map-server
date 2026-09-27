import {
  acquireDataImportLock,
} from '../db/database-locks.js';
import {
  createGeometryImportStorage,
} from '../db/geometry-import-storage.js';
import {
  createGeometryImportService,
} from '../modules/geometry/import-service.js';

export function createGeometryImportRuntime(
  pool,
  dependencies = {},
) {
  const storage =
    dependencies.storage ??
    createGeometryImportStorage(
      pool,
    );

  return createGeometryImportService(
    pool,
    {
      ...dependencies,
      storage,
      acquireLock:
        dependencies
          .acquireLock ??
        acquireDataImportLock,
    },
  );
}
