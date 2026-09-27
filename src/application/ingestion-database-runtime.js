import {
  acquireDataImportLock,
} from '../db/database-locks.js';
import {
  rebuildCityBoundaryHierarchy,
} from '../db/city-boundary-hierarchy.js';
import {
  RECALCULATE_CITY_STATISTICS_SQL,
} from '../db/recalculate-city-statistics.js';

export function createIngestionStatisticsRefresh(
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

export function withIngestionDatabaseDependencies(
  dependencies = {},
) {
  return {
    ...dependencies,
    acquireLock:
      dependencies.acquireLock ??
      acquireDataImportLock,
    recalculateStatistics:
      createIngestionStatisticsRefresh(
        dependencies,
      ),
  };
}

export function withBoundaryIngestionDatabaseDependencies(
  dependencies = {},
) {
  const recalculateStatistics =
    createIngestionStatisticsRefresh(
      dependencies,
    );

  return {
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
  };
}
