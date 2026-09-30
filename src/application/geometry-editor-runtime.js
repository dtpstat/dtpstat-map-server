import {
  randomUUID,
} from 'node:crypto';
import {
  createGeometryEditorStorage,
} from '../db/geometry-editor-storage.js';
import {
  createGeometryEditLeaseStorage,
} from '../db/geometry-edit-lease-storage.js';
import {
  createGeometryDiscussionStorage,
} from '../db/geometry-discussion-storage.js';
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
      leaseStorage:
        dependencies.leaseStorage ??
        createGeometryEditLeaseStorage(
          pool,
        ),
      discussionStorage:
        dependencies.discussionStorage ??
        createGeometryDiscussionStorage(
          pool,
        ),
      acquireLock:
        dependencies.acquireLock ??
        acquireDataImportLock,
      randomUUID:
        dependencies.randomUUID ??
        randomUUID,
      leaseSeconds:
        dependencies.leaseSeconds ??
        90,
    },
  );
}
