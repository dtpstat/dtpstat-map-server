import { createLineImportService } from '../modules/lines/import-service.js';
import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

/**
 * DB composition adapter for line GeoJSON import.
 *
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 * @param {{
 *   repository?: any,
 *   acquireLock?: (client: any, pool: any) => Promise<void>,
 *   recalculateStatistics?: (client: any) => Promise<{ rowCount: number }>,
 *   recalculateStatisticsSql?: string
 * }} [dependencies]
 */
export function createDataImportService(pool, dependencies = {}) {
  const recalculateStatisticsSql =
    dependencies.recalculateStatisticsSql ?? RECALCULATE_CITY_STATISTICS_SQL;

  return createLineImportService(pool, {
    ...dependencies,
    acquireLock:
      dependencies.acquireLock ?? acquireDataImportLock,
    recalculateStatistics:
      dependencies.recalculateStatistics ??
      ((client) => client.query(recalculateStatisticsSql)),
  });
}
