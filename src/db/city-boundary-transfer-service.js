import {
  createCityBoundaryTransferService as createCityBoundaryTransferUseCase,
} from '../modules/geometry/city-boundary-transfer-service.js';
import { acquireDataImportLock } from './database-locks.js';
import { rebuildCityBoundaryHierarchy } from './city-boundary-hierarchy.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

/**
 * DB composition adapter for portable city-boundary transfer.
 *
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 * @param {{
 *   repository?: any,
 *   acquireLock?: (client: any, pool: any) => Promise<void>,
 *   rebuildHierarchy?: (
 *     client: any,
 *     options: { signal?: AbortSignal, onProgress?: (progress: object) => void }
 *   ) => Promise<any>,
 *   syncDerivedData?: (client: any) => Promise<void>
 * }} [dependencies]
 */
export function createCityBoundaryTransferService(
  pool,
  dependencies = {},
) {
  return createCityBoundaryTransferUseCase(pool, {
    ...dependencies,
    acquireLock:
      dependencies.acquireLock ?? acquireDataImportLock,
    rebuildHierarchy:
      dependencies.rebuildHierarchy ?? rebuildCityBoundaryHierarchy,
    syncDerivedData:
      dependencies.syncDerivedData ??
      (async (client) => {
        // Restore exact OSM boundary links first. Active-boundary projection
        // can then realign city ownership while preserving existing line rows.
        await client.query('SELECT sync_active_boundary_cities()');
        await client.query('SELECT sync_active_boundary_populations()');
        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
      }),
  });
}
