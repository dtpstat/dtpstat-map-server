import {
  createCityBoundaryTransferService,
} from '../modules/geometry/city-boundary-transfer-service.js';
import {
  createPopulationImportService,
} from '../modules/population/import-service.js';
import {
  acquireDataImportLock,
} from '../db/database-locks.js';
import {
  rebuildCityBoundaryHierarchy,
} from '../db/city-boundary-hierarchy.js';
import {
  RECALCULATE_CITY_STATISTICS_SQL,
} from '../db/recalculate-city-statistics.js';

function createStatisticsRefresh(
  dependencies = {},
) {
  const recalculateStatisticsSql =
    dependencies.recalculateStatisticsSql ??
    RECALCULATE_CITY_STATISTICS_SQL;

  return dependencies.recalculateStatistics ??
    ((client) =>
      client.query(
        recalculateStatisticsSql,
      ));
}

/**
 * Compose portable city-boundary replacement with DB locking, hierarchy rebuild
 * and active-boundary derived-data synchronization.
 */
export function createCityBoundaryTransferRuntime(
  pool,
  dependencies = {},
) {
  const recalculateStatistics =
    createStatisticsRefresh(
      dependencies,
    );

  return createCityBoundaryTransferService(
    pool,
    {
      ...dependencies,
      acquireLock:
        dependencies.acquireLock ??
        acquireDataImportLock,
      rebuildHierarchy:
        dependencies.rebuildHierarchy ??
        rebuildCityBoundaryHierarchy,
      syncDerivedData:
        dependencies.syncDerivedData ??
        (async (client) => {
          await client.query(
            'SELECT sync_active_boundary_cities()',
          );
          await client.query(
            'SELECT sync_active_boundary_populations()',
          );
          await recalculateStatistics(
            client,
          );
        }),
    },
  );
}

/**
 * Compose population hierarchy import with the shared destructive-import lock
 * and city-statistics recalculation infrastructure.
 */
export function createPopulationImportRuntime(
  pool,
  dependencies = {},
) {
  return createPopulationImportService(
    pool,
    {
      ...dependencies,
      acquireLock:
        dependencies.acquireLock ??
        acquireDataImportLock,
      recalculateStatistics:
        createStatisticsRefresh(
          dependencies,
        ),
    },
  );
}
