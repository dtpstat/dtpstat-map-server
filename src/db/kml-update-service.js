import {
  createKmlUpdateService as createKmlUpdateUseCase,
  KmlUpdateMatchError,
} from '../modules/lines/kml-update-service.js';
import { acquireDataImportLock } from './database-locks.js';
import { RECALCULATE_CITY_STATISTICS_SQL } from './recalculate-city-statistics.js';

export { KmlUpdateMatchError };

/**
 * DB composition adapter for KML line import/update.
 *
 * @param {{ connect: () => Promise<any>, databaseSchema?: string }} pool
 * @param {any} config
 * @param {{
 *   download?: Function,
 *   parse?: Function,
 *   repository?: any,
 *   acquireLock?: (client: any, pool: any) => Promise<void>,
 *   recalculateStatistics?: (client: any) => Promise<any>,
 *   recalculateStatisticsSql?: string
 * }} [dependencies]
 */
export function createKmlUpdateService(pool, config, dependencies = {}) {
  const recalculateStatisticsSql =
    dependencies.recalculateStatisticsSql ??
    RECALCULATE_CITY_STATISTICS_SQL;

  return createKmlUpdateUseCase(pool, config, {
    ...dependencies,
    acquireLock:
      dependencies.acquireLock ?? acquireDataImportLock,
    recalculateStatistics:
      dependencies.recalculateStatistics ??
      ((client) => client.query(recalculateStatisticsSql)),
  });
}
