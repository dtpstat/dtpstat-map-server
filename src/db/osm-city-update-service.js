import {
  createOsmCityUpdateService as createOsmCityUpdateUseCase,
  OsmCityGeometryError,
} from '../modules/osm/update-service.js';
import { acquireDataImportLock } from './database-locks.js';
import { rebuildCityBoundaryHierarchy } from './city-boundary-hierarchy.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

export { OsmCityGeometryError };

/**
 * DB composition adapter for the OSM update use case.
 *
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 * @param {any} config
 * @param {Record<string, any>} [dependencies]
 */
export function createOsmCityUpdateService(pool, config, dependencies = {}) {
  return createOsmCityUpdateUseCase(pool, config, {
    ...dependencies,
    acquireLock: dependencies.acquireLock ?? acquireDataImportLock,
    rebuildHierarchy:
      dependencies.rebuildHierarchy ?? rebuildCityBoundaryHierarchy,
    syncDerivedData:
      dependencies.syncDerivedData ??
      (async (client) => {
        // DELETE FROM city_boundaries temporarily clears boundary_id through
        // ON DELETE SET NULL. Restore exact OSM links before synchronizing
        // city_id so renamed/reassigned active boundaries realign existing
        // line rows in the same transaction.
        await client.query('SELECT sync_active_boundary_cities()');
        await client.query('SELECT sync_active_boundary_populations()');
        await client.query(RECALCULATE_CITY_STATISTICS_SQL);
      }),
  });
}
