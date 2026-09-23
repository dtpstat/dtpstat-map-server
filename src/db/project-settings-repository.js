import {
  createProjectSettingsService,
} from '../modules/project/settings-service.js';
import { acquireDataImportLock } from './database-locks.js';
import {
  createProjectSettingsStorageRepository,
} from './project-settings-storage-repository.js';
import {
  RECALCULATE_CITY_STATISTICS_SQL,
} from './recalculate-city-statistics.js';

/**
 * DB composition adapter for project settings.
 *
 * @param {{
 *   query: (text: string, values?: unknown[]) => Promise<any>,
 *   connect?: () => Promise<any>,
 *   databaseSchema?: string
 * }} database
 * @param {{
 *   styleUrl?: string,
 *   initialCenter?: number[],
 *   initialZoom?: number
 * }} publicMapDefaults
 * @param {{
 *   storage?: ReturnType<typeof createProjectSettingsStorageRepository>,
 *   acquireLock?: (client: any, pool: any) => Promise<void>,
 *   recalculateStatistics?: (queryable: any) => Promise<any>,
 *   recalculateStatisticsSql?: string
 * }} [dependencies]
 */
export function createProjectSettingsRepository(
  database,
  publicMapDefaults = {},
  dependencies = {},
) {
  const recalculateStatisticsSql =
    dependencies.recalculateStatisticsSql ??
    RECALCULATE_CITY_STATISTICS_SQL;

  return createProjectSettingsService(
    database,
    publicMapDefaults,
    {
      ...dependencies,
      storage:
        dependencies.storage ??
        createProjectSettingsStorageRepository(),
      acquireLock:
        dependencies.acquireLock ??
        acquireDataImportLock,
      recalculateStatistics:
        dependencies.recalculateStatistics ??
        ((queryable) =>
          queryable.query(recalculateStatisticsSql)),
    },
  );
}
