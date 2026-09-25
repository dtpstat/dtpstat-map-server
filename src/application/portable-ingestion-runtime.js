import {
  createCityBoundaryTransferService,
} from '../modules/geometry/city-boundary-transfer-service.js';
import {
  createPopulationImportService,
} from '../modules/population/import-service.js';
import {
  withBoundaryIngestionDatabaseDependencies,
  withIngestionDatabaseDependencies,
} from './ingestion-database-runtime.js';

/**
 * Compose portable city-boundary replacement with DB locking, hierarchy rebuild
 * and active-boundary derived-data synchronization.
 */
export function createCityBoundaryTransferRuntime(
  pool,
  dependencies = {},
) {
  return createCityBoundaryTransferService(
    pool,
    withBoundaryIngestionDatabaseDependencies(
      dependencies,
    ),
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
    withIngestionDatabaseDependencies(
      dependencies,
    ),
  );
}
