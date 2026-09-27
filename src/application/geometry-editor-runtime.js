import {
  createGeometryEditorStorage,
} from '../db/geometry-editor-storage.js';
import {
  acquireDataImportLock,
} from '../db/database-locks.js';
import {
  createGeometryEditorService,
} from '../modules/geometry/editor-service.js';

export function createGeometryEditorRuntime(
  pool,
  dependencies = {},
) {
  return createGeometryEditorService(
    pool,
    {
      storage:
        dependencies.storage ??
        createGeometryEditorStorage(
          pool,
        ),
      acquireLock:
        dependencies.acquireLock ??
        acquireDataImportLock,
    },
  );
}
