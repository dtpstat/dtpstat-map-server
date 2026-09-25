import {
  createLineImportService,
} from '../modules/lines/import-service.js';
import {
  createKmlUpdateService,
} from '../modules/lines/kml-update-service.js';
import {
  acquireDataImportLock,
} from '../db/database-locks.js';
import {
  RECALCULATE_CITY_STATISTICS_SQL,
} from '../db/recalculate-city-statistics.js';

function withDatabaseDependencies(dependencies = {}) {
  const recalculateStatisticsSql =
    dependencies.recalculateStatisticsSql ??
    RECALCULATE_CITY_STATISTICS_SQL;

  return {
    ...dependencies,
    acquireLock:
      dependencies.acquireLock ??
      acquireDataImportLock,
    recalculateStatistics:
      dependencies.recalculateStatistics ??
      ((client) =>
        client.query(
          recalculateStatisticsSql,
        )),
  };
}

/**
 * Compose the line GeoJSON use case with the shared destructive-import lock
 * and city-statistics recalculation infrastructure.
 */
export function createLineImportRuntime(
  pool,
  dependencies = {},
) {
  return createLineImportService(
    pool,
    withDatabaseDependencies(
      dependencies,
    ),
  );
}

/**
 * Compose the KML update use case with the same DB transaction infrastructure
 * used by portable line imports.
 */
export function createKmlUpdateRuntime(
  pool,
  config,
  dependencies = {},
) {
  return createKmlUpdateService(
    pool,
    config,
    withDatabaseDependencies(
      dependencies,
    ),
  );
}
