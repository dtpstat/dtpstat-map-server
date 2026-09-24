import {
  createOsmBoundaryAdminService,
  OsmBoundaryAdminValidationError,
} from '../modules/osm/boundary-admin-service.js';
import { acquireDataImportLock } from './database-locks.js';
import {
  createOsmBoundaryAdminStorage,
} from './osm-boundary-admin-storage.js';
import {
  RECALCULATE_CITY_STATISTICS_SQL,
} from './recalculate-city-statistics.js';

export { OsmBoundaryAdminValidationError };

/**
 * DB composition adapter for OSM boundary administration.
 *
 * @param {{
 *   query: Function,
 *   connect: () => Promise<any>
 * }} pool
 * @param {{
 *   storage?: ReturnType<typeof createOsmBoundaryAdminStorage>,
 *   acquireLock?: (client: any, pool: any) => Promise<void>,
 *   syncDerivedData?: (client: any) => Promise<void>
 * }} [dependencies]
 */
export function createOsmBoundaryAdminRepository(
  pool,
  dependencies = {},
) {
  return createOsmBoundaryAdminService(pool, {
    ...dependencies,
    storage:
      dependencies.storage ??
      createOsmBoundaryAdminStorage(pool),
    acquireLock:
      dependencies.acquireLock ??
      acquireDataImportLock,
    syncDerivedData:
      dependencies.syncDerivedData ??
      (async (client) => {
        await client.query(
          'SELECT sync_active_boundary_cities()',
        );
        await client.query(
          'SELECT sync_active_boundary_populations()',
        );
        await client.query(
          RECALCULATE_CITY_STATISTICS_SQL,
        );
      }),
  });
}
