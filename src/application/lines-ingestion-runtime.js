import {
  createLineImportService,
} from '../modules/lines/import-service.js';
import {
  createKmlUpdateService,
} from '../modules/lines/kml-update-service.js';
import {
  withIngestionDatabaseDependencies,
} from './ingestion-database-runtime.js';

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
    withIngestionDatabaseDependencies(
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
    withIngestionDatabaseDependencies(
      dependencies,
    ),
  );
}
