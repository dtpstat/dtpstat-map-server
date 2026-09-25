import {
  createOsmCityUpdateService,
} from '../modules/osm/update-service.js';
import {
  withBoundaryIngestionDatabaseDependencies,
} from './ingestion-database-runtime.js';

export {
  OsmCityGeometryError,
} from '../modules/osm/update-errors.js';

/**
 * Compose OSM boundary replacement with shared ingestion DB infrastructure.
 */
export function createOsmCityUpdateRuntime(
  pool,
  config,
  dependencies = {},
) {
  return createOsmCityUpdateService(
    pool,
    config,
    withBoundaryIngestionDatabaseDependencies(
      dependencies,
    ),
  );
}
