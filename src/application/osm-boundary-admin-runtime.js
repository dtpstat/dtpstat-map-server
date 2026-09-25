import {
  createOsmBoundaryAdminStorage,
} from '../db/osm-boundary-admin-storage.js';
import {
  createOsmBoundaryAdminService,
} from '../modules/osm/boundary-admin-service.js';
import {
  withBoundaryIngestionDatabaseDependencies,
} from './ingestion-database-runtime.js';

/**
 * Compose OSM boundary administration with SQL storage and shared boundary
 * ingestion database infrastructure.
 */
export function createOsmBoundaryAdminRuntime(
  pool,
  dependencies = {},
) {
  const databaseDependencies =
    withBoundaryIngestionDatabaseDependencies(
      dependencies,
    );

  return createOsmBoundaryAdminService(
    pool,
    {
      storage:
        dependencies.storage ??
        createOsmBoundaryAdminStorage(pool),
      acquireLock:
        databaseDependencies.acquireLock,
      syncDerivedData:
        databaseDependencies.syncDerivedData,
    },
  );
}
