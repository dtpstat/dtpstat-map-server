import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(root, 'src');

async function jsFiles(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return jsFiles(target);
      return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
    }));
    return nested.flat();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function importSpecifiers(source) {
  const specifiers = [];
  const staticImport =
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gu;
  const dynamicImport = /import\(\s*['"]([^'"]+)['"]\s*\)/gu;
  for (const pattern of [staticImport, dynamicImport]) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveRelativeImport(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  return path.resolve(path.dirname(file), specifier);
}

test('lightweight domain modules keep dependency direction explicit', async () => {
  const moduleFiles = await jsFiles(path.join(srcRoot, 'modules'));
  for (const file of moduleFiles) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveRelativeImport(file, specifier);
      assert.ok(
        !resolved ||
          (
            !resolved.startsWith(path.join(srcRoot, 'routes') + path.sep) &&
            !resolved.startsWith(path.join(srcRoot, 'db') + path.sep)
          ),
        `${path.relative(root, file)} must not depend on legacy src/routes or src/db`,
      );
    }
  }

  const sharedFiles = await jsFiles(path.join(srcRoot, 'shared'));
  for (const file of sharedFiles) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveRelativeImport(file, specifier);
      assert.ok(
        !resolved ||
          (
            !resolved.startsWith(path.join(srcRoot, 'modules') + path.sep) &&
            !resolved.startsWith(path.join(srcRoot, 'application') + path.sep)
          ),
        `${path.relative(root, file)} must not depend on modules/application`,
      );
    }
  }

  const dataFiles = await jsFiles(path.join(srcRoot, 'data'));
  for (const file of dataFiles) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      assert.doesNotMatch(
        specifier,
        /^(?:express(?:\/|$)|node:http(?:\/|$))/u,
        `${path.relative(root, file)} must stay HTTP-framework independent`,
      );
      const resolved = resolveRelativeImport(file, specifier);
      assert.ok(
        !resolved || !resolved.startsWith(path.join(srcRoot, 'http') + path.sep),
        `${path.relative(root, file)} must not depend on src/http`,
      );
    }
  }
});

test('legacy API file is a composition root for extracted route modules', async () => {
  const source = await fs.readFile(path.join(srcRoot, 'routes', 'api.js'), 'utf8');

  assert.match(source, /createAdminTaskHttpRuntime\(/u);
  assert.match(source, /createDataTransferRuntime\(/u);
  assert.doesNotMatch(
    source,
    /^import[\s\S]*?from ['"]\.\.\/(?:data|http)\//mu,
  );

  assert.match(source, /registerMapRoutes\(router,/u);
  assert.match(source, /registerDataExportRoutes\(router,/u);
  assert.match(source, /registerDataImportRoutes\(router,/u);
  assert.match(source, /registerLineRoutes\(router,/u);
  assert.match(source, /registerOsmRoutes\(router,/u);
  assert.match(source, /registerAdminTaskRoutes\(router,/u);
  assert.match(source, /registerPopulationRoutes\(router,/u);
  assert.doesNotMatch(source, /\brouter\.(?:get|post|put|patch|delete)\s*\(/u);
});


test('OSM update facade delegates Overpass request lifecycle to the module', async () => {
  const source = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-service.js'),
    'utf8',
  );
  const requestSession = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'overpass-request-session.js'),
    'utf8',
  );

  assert.match(source, /createOverpassRequestSession\(/u);
  assert.doesNotMatch(source, /RETRYABLE_HTTP_STATUS_CODES/u);
  assert.doesNotMatch(source, /GEOMETRY_504_RETRIES_BEFORE_SPLIT/u);
  assert.match(requestSession, /RETRYABLE_HTTP_STATUS_CODES/u);
  assert.match(requestSession, /GEOMETRY_504_RETRIES_BEFORE_SPLIT/u);
  assert.match(requestSession, /async downloadQuery\(/u);
});


test('OSM update facade delegates checkpoint compatibility and lifecycle policy', async () => {
  const source = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-service.js'),
    'utf8',
  );
  const policy = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-checkpoint-policy.js'),
    'utf8',
  );
  const session = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-checkpoint-session.js'),
    'utf8',
  );
  const metrics = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-request-metrics.js'),
    'utf8',
  );

  assert.match(source, /checkpointSettingsFingerprint\(options\)/u);
  assert.match(source, /prepareOsmCheckpoint\(/u);
  assert.match(source, /preparePendingOsmGeometry\(/u);
  assert.match(source, /materializeReadyOsmCheckpoint\(/u);
  assert.match(source, /persistOsmCheckpointFailure\(/u);
  assert.match(source, /createOsmRequestMetricsState\(/u);
  assert.doesNotMatch(source, /checkpointCompletionChecksum\(/u);
  assert.doesNotMatch(source, /checkpointErrorDetails\(/u);
  assert.doesNotMatch(source, /checkpointRepository\.getStagedKeys\(/u);
  assert.doesNotMatch(source, /checkpointRepository\.addMetrics\(/u);
  assert.doesNotMatch(source, /function checkpointMode\(/u);
  assert.doesNotMatch(source, /function checkpointOptionSnapshot\(/u);
  assert.match(policy, /export function checkpointMode\(/u);
  assert.match(policy, /export function checkpointOptionSnapshot\(/u);
  assert.match(policy, /export function checkpointCompletionChecksum\(/u);
  assert.match(session, /checkpointCompletionChecksum\(/u);
  assert.match(session, /checkpointErrorDetails\(/u);
  assert.match(session, /checkpointRepository\.getStagedKeys\(/u);
  assert.match(session, /checkpointRepository\.addMetrics\(/u);
  assert.match(metrics, /export function createOsmRequestMetricsState\(/u);
});


test('OSM update facade delegates boundary persistence to repository', async () => {
  const source = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-service.js'),
    'utf8',
  );
  const geometrySession = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-geometry-session.js'),
    'utf8',
  );
  const repository = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'boundary-update-repository.js'),
    'utf8',
  );

  const commitSession = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-commit-session.js'),
    'utf8',
  );

  assert.match(source, /createOsmBoundaryUpdateRepository\(/u);
  assert.match(source, /boundaryUpdateRepository,\n\s+client,/u);
  assert.doesNotMatch(source, /boundaryUpdateRepository\.insertBoundaries\(/u);
  assert.doesNotMatch(source, /boundaryUpdateRepository\.stageBatch\(/u);
  assert.doesNotMatch(source, /INSERT INTO city_boundaries/u);
  assert.doesNotMatch(source, /osm_city_boundary_stage/u);
  assert.match(commitSession, /boundaryUpdateRepository\.insertBoundaries\(/u);
  assert.match(geometrySession, /boundaryUpdateRepository\.stageBatch\(/u);
  assert.match(repository, /async stageBatch\(/u);
  assert.match(repository, /INSERT INTO city_boundaries/u);
  assert.match(repository, /osm_city_boundary_stage/u);
});


test('OSM update facade delegates index composition and batch policy', async () => {
  const source = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-service.js'),
    'utf8',
  );
  const indexSession = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-index-session.js'),
    'utf8',
  );
  const geometrySession = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-geometry-session.js'),
    'utf8',
  );
  const batchPolicy = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-batch-policy.js'),
    'utf8',
  );

  assert.match(source, /loadOsmUpdateIndex\(/u);
  assert.doesNotMatch(source, /createObjectBatches\(/u);
  assert.doesNotMatch(source, /function combineIndexParts\(/u);
  assert.doesNotMatch(source, /buildRussianPlaceIdOverpassQueries/u);
  assert.match(indexSession, /buildRussianPlaceIdOverpassQueries\(/u);
  assert.match(indexSession, /combineIndexParts\(/u);
  assert.match(geometrySession, /createObjectBatches\(/u);
  assert.match(batchPolicy, /export function assertCompleteBatch\(/u);
  assert.match(batchPolicy, /export function createObjectBatches\(/u);
});


test('OSM update facade delegates geometry batch processing to session', async () => {
  const source = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-service.js'),
    'utf8',
  );
  const geometrySession = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-geometry-session.js'),
    'utf8',
  );

  assert.match(source, /processOsmGeometryBatches\(/u);
  assert.doesNotMatch(source, /buildOsmPlacesBatchQuery/u);
  assert.doesNotMatch(source, /geometry-504-retry-limit/u);
  assert.doesNotMatch(source, /const splitAt =/u);
  assert.doesNotMatch(source, /geometryBatches\.splice\(/u);
  assert.match(geometrySession, /buildOsmPlacesBatchQuery\(/u);
  assert.match(geometrySession, /geometry-504-retry-limit/u);
  assert.match(geometrySession, /const splitAt =/u);
  assert.match(geometrySession, /geometryBatches\.splice\(/u);
  assert.match(geometrySession, /splitSizes/u);
  assert.match(geometrySession, /boundaryUpdateRepository\.stageBatch\(/u);
  assert.match(geometrySession, /checkpointRepository\.stageBatch\(/u);
});


test('OSM update facade delegates atomic replacement transaction to commit session', async () => {
  const source = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-service.js'),
    'utf8',
  );
  const commitSession = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-commit-session.js'),
    'utf8',
  );
  const checkpointRepository = await fs.readFile(
    path.join(srcRoot, 'db', 'osm-city-checkpoint-repository.js'),
    'utf8',
  );

  assert.match(source, /commitOsmBoundaryUpdate\(/u);
  assert.doesNotMatch(source, /client\.query\('BEGIN'\)/u);
  assert.doesNotMatch(source, /client\.query\('COMMIT'\)/u);
  assert.doesNotMatch(source, /client\.query\('ROLLBACK'\)/u);
  assert.doesNotMatch(source, /DELETE FROM osm_city_update_checkpoint_stage/u);
  assert.match(commitSession, /client\.query\('BEGIN'\)/u);
  assert.match(commitSession, /client\.query\('COMMIT'\)/u);
  assert.match(commitSession, /client\.query\('ROLLBACK'\)/u);
  assert.match(commitSession, /checkpointRepository\.complete\(/u);
  assert.match(checkpointRepository, /async complete\(client, checkpointId\)/u);
});


test('OSM update facade delegates runtime options progress and result assembly', async () => {
  const source = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-service.js'),
    'utf8',
  );
  const runtimeOptions = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-runtime-options.js'),
    'utf8',
  );
  const progressReporter = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-progress-reporter.js'),
    'utf8',
  );
  const resultBuilder = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-result.js'),
    'utf8',
  );

  assert.match(source, /resolveOsmUpdateRuntimeOptions\(/u);
  assert.match(source, /reportOsmUpdateProgress/u);
  assert.match(source, /buildOsmUpdateRunValues\(/u);
  assert.match(source, /buildOsmUpdateResult\(/u);
  assert.match(source, /finalizeOsmUpdateResult\(/u);
  assert.doesNotMatch(source, /Saved OSM URL is no longer allowed/u);
  assert.doesNotMatch(source, /OSM city update index \$\{/u);
  assert.doesNotMatch(source, /indexRequestCount:/u);
  assert.match(runtimeOptions, /Saved OSM URL is no longer allowed/u);
  assert.match(progressReporter, /OSM city update index \$\{/u);
  assert.match(resultBuilder, /indexRequestCount:/u);
});


test('legacy OSM DB service is only an infrastructure composition adapter', async () => {
  const adapter = await fs.readFile(
    path.join(srcRoot, 'db', 'osm-city-update-service.js'),
    'utf8',
  );
  const useCase = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-service.js'),
    'utf8',
  );

  assert.match(adapter, /createOsmCityUpdateUseCase\(pool, config,/u);
  assert.match(adapter, /acquireDataImportLock/u);
  assert.match(adapter, /rebuildCityBoundaryHierarchy/u);
  assert.match(adapter, /RECALCULATE_CITY_STATISTICS_SQL/u);
  assert.doesNotMatch(adapter, /createOverpassRequestSession/u);
  assert.doesNotMatch(adapter, /processOsmGeometryBatches/u);
  assert.doesNotMatch(adapter, /loadOsmUpdateIndex/u);
  assert.doesNotMatch(adapter, /prepareOsmCheckpoint/u);

  assert.match(useCase, /createOverpassRequestSession\(/u);
  assert.match(useCase, /processOsmGeometryBatches\(/u);
  assert.match(useCase, /loadOsmUpdateIndex\(/u);
  assert.match(useCase, /prepareOsmCheckpoint\(/u);
  assert.doesNotMatch(useCase, /\.\.\/\.\.\/db\//u);
  assert.doesNotMatch(useCase, /database-locks/u);
  assert.doesNotMatch(useCase, /city-boundary-hierarchy/u);
  assert.doesNotMatch(useCase, /recalculate-city-statistics/u);
});


test('line import use case delegates SQL persistence to lines repository', async () => {
  const service = await fs.readFile(
    path.join(srcRoot, 'modules', 'lines', 'import-service.js'),
    'utf8',
  );
  const repository = await fs.readFile(
    path.join(srcRoot, 'modules', 'lines', 'import-repository.js'),
    'utf8',
  );

  assert.match(service, /createLineImportRepository\(/u);
  assert.match(service, /repository\.insertRawBatch\(/u);
  assert.match(service, /repository\.insertNormalizedBatch\(/u);
  assert.match(service, /repository\.insertGeometries\(/u);
  assert.doesNotMatch(service, /CREATE TEMP TABLE line_transfer_raw/u);
  assert.doesNotMatch(service, /INSERT INTO city_geometries/u);
  assert.doesNotMatch(service, /DELETE FROM line_types AS line_type/u);

  assert.match(repository, /CREATE TEMP TABLE line_transfer_raw/u);
  assert.match(repository, /INSERT INTO city_geometries/u);
  assert.match(repository, /DELETE FROM line_types AS line_type/u);
});

test('legacy line data import service is only a DB composition adapter', async () => {
  const adapter = await fs.readFile(
    path.join(srcRoot, 'db', 'data-import-service.js'),
    'utf8',
  );
  const service = await fs.readFile(
    path.join(srcRoot, 'modules', 'lines', 'import-service.js'),
    'utf8',
  );

  assert.match(adapter, /createLineImportService\(pool,/u);
  assert.match(adapter, /acquireDataImportLock/u);
  assert.match(adapter, /RECALCULATE_CITY_STATISTICS_SQL/u);
  assert.doesNotMatch(adapter, /parseStreamingJsonObject/u);
  assert.doesNotMatch(adapter, /buildGeoJsonPlan/u);
  assert.doesNotMatch(adapter, /repository\.insertGeometries/u);

  assert.match(service, /parseStreamingJsonObject\(/u);
  assert.match(service, /buildGeoJsonPlan\(/u);
  assert.match(service, /repository\.insertGeometries\(/u);
  assert.doesNotMatch(service, /\.\.\/\.\.\/db\//u);
  assert.doesNotMatch(service, /database-locks/u);
  assert.doesNotMatch(service, /recalculate-city-statistics/u);
});


test('city boundary transfer use case delegates SQL persistence to geometry repository', async () => {
  const service = await fs.readFile(
    path.join(
      srcRoot,
      'modules',
      'geometry',
      'city-boundary-transfer-service.js',
    ),
    'utf8',
  );
  const repository = await fs.readFile(
    path.join(
      srcRoot,
      'modules',
      'geometry',
      'city-boundary-transfer-repository.js',
    ),
    'utf8',
  );

  assert.match(service, /createCityBoundaryTransferRepository\(/u);
  assert.match(service, /repository\.insertStageBatch\(/u);
  assert.match(service, /repository\.insertBoundaries\(/u);
  assert.match(service, /repository\.restoreGeometryLinks\(/u);
  assert.doesNotMatch(
    service,
    /CREATE TEMP TABLE city_boundary_transfer_stage/u,
  );
  assert.doesNotMatch(service, /INSERT INTO city_boundaries/u);
  assert.doesNotMatch(service, /UPDATE city_geometries/u);

  assert.match(
    repository,
    /CREATE TEMP TABLE city_boundary_transfer_stage/u,
  );
  assert.match(repository, /INSERT INTO city_boundaries/u);
  assert.match(repository, /UPDATE city_geometries/u);
});

test('legacy city boundary transfer service is only a DB composition adapter', async () => {
  const adapter = await fs.readFile(
    path.join(srcRoot, 'db', 'city-boundary-transfer-service.js'),
    'utf8',
  );
  const service = await fs.readFile(
    path.join(
      srcRoot,
      'modules',
      'geometry',
      'city-boundary-transfer-service.js',
    ),
    'utf8',
  );

  assert.match(adapter, /createCityBoundaryTransferUseCase\(pool,/u);
  assert.match(adapter, /acquireDataImportLock/u);
  assert.match(adapter, /rebuildCityBoundaryHierarchy/u);
  assert.match(adapter, /RECALCULATE_CITY_STATISTICS_SQL/u);
  assert.doesNotMatch(adapter, /parseStreamingJsonObject/u);
  assert.doesNotMatch(adapter, /buildCityBoundaryGeoJsonPlan/u);
  assert.doesNotMatch(adapter, /repository\.insertStageBatch/u);

  assert.match(service, /parseStreamingJsonObject\(/u);
  assert.match(service, /buildCityBoundaryGeoJsonPlan\(/u);
  assert.match(service, /repository\.insertStageBatch\(/u);
  assert.match(service, /rebuildHierarchy\(client,/u);
  assert.match(service, /syncDerivedData\(client\)/u);
  assert.doesNotMatch(service, /\.\.\/\.\.\/db\//u);
  assert.doesNotMatch(service, /database-locks/u);
  assert.doesNotMatch(service, /city-boundary-hierarchy/u);
  assert.doesNotMatch(service, /recalculate-city-statistics/u);
});


test('population import use case delegates SQL persistence to population repository', async () => {
  const service = await fs.readFile(
    path.join(srcRoot, 'modules', 'population', 'import-service.js'),
    'utf8',
  );
  const repository = await fs.readFile(
    path.join(srcRoot, 'modules', 'population', 'import-repository.js'),
    'utf8',
  );

  assert.match(service, /createPopulationImportRepository\(/u);
  assert.match(service, /repository\.insertRawBatch\(/u);
  assert.match(service, /repository\.insertStageBatch\(/u);
  assert.match(service, /repository\.resolveStage\(/u);
  assert.match(service, /repository\.updateCities\(/u);
  assert.doesNotMatch(
    service,
    /CREATE TEMP TABLE population_transfer_raw/u,
  );
  assert.doesNotMatch(
    service,
    /CREATE TEMP TABLE population_transfer_resolved/u,
  );
  assert.doesNotMatch(service, /UPDATE city_boundaries AS boundary/u);

  assert.match(
    repository,
    /CREATE TEMP TABLE population_transfer_raw/u,
  );
  assert.match(
    repository,
    /CREATE TEMP TABLE population_transfer_resolved/u,
  );
  assert.match(repository, /UPDATE city_boundaries AS boundary/u);
});

test('legacy population import service is only a DB composition adapter', async () => {
  const adapter = await fs.readFile(
    path.join(srcRoot, 'db', 'population-import-service.js'),
    'utf8',
  );
  const service = await fs.readFile(
    path.join(srcRoot, 'modules', 'population', 'import-service.js'),
    'utf8',
  );

  assert.match(adapter, /createPopulationImportUseCase\(pool,/u);
  assert.match(adapter, /acquireDataImportLock/u);
  assert.match(adapter, /RECALCULATE_CITY_STATISTICS_SQL/u);
  assert.doesNotMatch(adapter, /parseStreamingJsonObject/u);
  assert.doesNotMatch(adapter, /buildPopulationPlan/u);
  assert.doesNotMatch(adapter, /repository\.resolveStage/u);

  assert.match(service, /parseStreamingJsonObject\(/u);
  assert.match(service, /buildPopulationPlan\(/u);
  assert.match(service, /repository\.resolveStage\(/u);
  assert.match(service, /recalculateStatistics\(client\)/u);
  assert.doesNotMatch(service, /\.\.\/\.\.\/db\//u);
  assert.doesNotMatch(service, /database-locks/u);
  assert.doesNotMatch(service, /recalculate-city-statistics/u);
});


test('KML update use case delegates SQL persistence to lines repository', async () => {
  const service = await fs.readFile(
    path.join(srcRoot, 'modules', 'lines', 'kml-update-service.js'),
    'utf8',
  );
  const repository = await fs.readFile(
    path.join(srcRoot, 'modules', 'lines', 'kml-update-repository.js'),
    'utf8',
  );

  assert.match(service, /createKmlUpdateRepository\(/u);
  assert.match(service, /repository\.loadLineTypes\(/u);
  assert.match(service, /repository\.matchGeometries\(/u);
  assert.match(service, /repository\.insertGeometries\(/u);
  assert.match(service, /repository\.insertUpdateRun\(/u);
  assert.doesNotMatch(
    service,
    /CREATE TEMP TABLE kml_place_match_geometries/u,
  );
  assert.doesNotMatch(service, /INSERT INTO city_geometries/u);
  assert.doesNotMatch(service, /INSERT INTO geometry_update_runs/u);

  assert.match(
    repository,
    /CREATE TEMP TABLE kml_place_match_geometries/u,
  );
  assert.match(repository, /INSERT INTO city_geometries/u);
  assert.match(repository, /INSERT INTO geometry_update_runs/u);
});

test('legacy KML update service is only a DB composition adapter', async () => {
  const adapter = await fs.readFile(
    path.join(srcRoot, 'db', 'kml-update-service.js'),
    'utf8',
  );
  const service = await fs.readFile(
    path.join(srcRoot, 'modules', 'lines', 'kml-update-service.js'),
    'utf8',
  );

  assert.match(adapter, /createKmlUpdateUseCase\(pool, config,/u);
  assert.match(adapter, /acquireDataImportLock/u);
  assert.match(adapter, /RECALCULATE_CITY_STATISTICS_SQL/u);
  assert.match(adapter, /export \{ KmlUpdateMatchError \}/u);
  assert.doesNotMatch(adapter, /downloadKml/u);
  assert.doesNotMatch(adapter, /parseKmlSource/u);
  assert.doesNotMatch(adapter, /repository\.matchGeometries/u);

  assert.match(service, /downloadKml/u);
  assert.match(service, /parseKmlSource/u);
  assert.match(service, /repository\.matchGeometries\(/u);
  assert.match(service, /recalculateStatistics\(client\)/u);
  assert.doesNotMatch(service, /\.\.\/\.\.\/db\//u);
  assert.doesNotMatch(service, /database-locks/u);
  assert.doesNotMatch(service, /recalculate-city-statistics/u);
});


test('project settings transfer application service delegates policy and persistence', async () => {
  const service = await fs.readFile(
    path.join(
      srcRoot,
      'application',
      'data-transfer',
      'project-settings-service.js',
    ),
    'utf8',
  );
  const policy = await fs.readFile(
    path.join(
      srcRoot,
      'modules',
      'project',
      'settings-transfer-policy.js',
    ),
    'utf8',
  );
  const repository = await fs.readFile(
    path.join(srcRoot, 'db', 'project-settings-transfer-repository.js'),
    'utf8',
  );

  assert.match(service, /validateProjectSettingsTransferEnvelope\(/u);
  assert.match(service, /normalizeTransferredProjectSettings\(/u);
  assert.match(service, /repository\.replaceLineTypes\(/u);
  assert.match(service, /repository\.materializeReport\(/u);
  assert.doesNotMatch(service, /UPDATE project_settings SET/u);
  assert.doesNotMatch(service, /CREATE TEMP TABLE project_settings_line_types_stage/u);

  assert.match(policy, /PROJECT_SETTINGS_TRANSFER_SCHEMA_VERSION = 8/u);
  assert.match(policy, /normalizeTransferredSecuritySettings/u);
  assert.match(repository, /UPDATE project_settings SET/u);
  assert.match(repository, /CREATE TEMP TABLE project_settings_line_types_stage/u);
});

test('legacy project settings transfer service is only a DB composition adapter', async () => {
  const adapter = await fs.readFile(
    path.join(srcRoot, 'db', 'project-settings-transfer-service.js'),
    'utf8',
  );
  const service = await fs.readFile(
    path.join(
      srcRoot,
      'application',
      'data-transfer',
      'project-settings-service.js',
    ),
    'utf8',
  );

  assert.match(adapter, /createProjectSettingsTransferUseCase\(pool,/u);
  assert.match(adapter, /createProjectSettingsTransferRepository\(/u);
  assert.match(adapter, /acquireDataImportLock/u);
  assert.doesNotMatch(adapter, /validateProjectSettingsTransferEnvelope/u);
  assert.doesNotMatch(adapter, /validateReportConfig/u);
  assert.doesNotMatch(adapter, /UPDATE project_settings SET/u);

  assert.match(service, /validateProjectSettingsTransferEnvelope\(/u);
  assert.match(service, /validateReportConfig\(/u);
  assert.doesNotMatch(service, /database-locks/u);
  assert.doesNotMatch(service, /recalculate-city-statistics/u);
  assert.doesNotMatch(service, /report-config-service/u);
});


test('reporting module separates config use case from query compiler and DB storage', async () => {
  const service = await fs.readFile(
    path.join(srcRoot, 'modules', 'reporting', 'config-service.js'),
    'utf8',
  );
  const compiler = await fs.readFile(
    path.join(srcRoot, 'modules', 'reporting', 'query-compiler.js'),
    'utf8',
  );
  const repository = await fs.readFile(
    path.join(srcRoot, 'db', 'report-config-repository.js'),
    'utf8',
  );
  const materializer = await fs.readFile(
    path.join(srcRoot, 'db', 'report-materialization-repository.js'),
    'utf8',
  );

  assert.match(service, /repository\.load\(/u);
  assert.match(service, /repository\.save\(/u);
  assert.match(service, /materialize\(client,/u);
  assert.doesNotMatch(service, /jsonb_object_agg\(config_key/u);
  assert.doesNotMatch(service, /INSERT INTO city_report_values/u);

  assert.match(compiler, /compileReportMetricQuery/u);
  assert.match(compiler, /compileReportRankQuery/u);
  assert.doesNotMatch(compiler, /\.\.\/\.\.\/db\//u);

  assert.match(repository, /jsonb_object_agg\(config_key, config_value\)/u);
  assert.match(repository, /ON CONFLICT \(config_key\)/u);

  assert.match(materializer, /INSERT INTO city_report_values/u);
  assert.match(materializer, /compileReportMetricQuery\(/u);
  assert.match(materializer, /compileReportRankQuery\(/u);
});

test('legacy report config service is only a DB composition adapter', async () => {
  const adapter = await fs.readFile(
    path.join(srcRoot, 'db', 'report-config-service.js'),
    'utf8',
  );
  const service = await fs.readFile(
    path.join(srcRoot, 'modules', 'reporting', 'config-service.js'),
    'utf8',
  );
  const transferRepository = await fs.readFile(
    path.join(srcRoot, 'db', 'project-settings-transfer-repository.js'),
    'utf8',
  );

  assert.match(adapter, /createReportConfigUseCase\(pool,/u);
  assert.match(adapter, /createReportConfigRepository\(/u);
  assert.match(adapter, /materializeReportValues/u);
  assert.match(adapter, /acquireDataImportLock/u);
  assert.match(adapter, /compileReportMetricQuery/u);
  assert.match(adapter, /compileReportRankQuery/u);
  assert.doesNotMatch(adapter, /jsonb_object_agg\(config_key/u);
  assert.doesNotMatch(adapter, /INSERT INTO city_report_values/u);

  assert.match(service, /validateReportConfig\(/u);
  assert.doesNotMatch(service, /database-locks/u);
  assert.doesNotMatch(service, /report-config-repository/u);

  assert.match(
    transferRepository,
    /materializeReportValues\(client, config\)/u,
  );
  assert.doesNotMatch(
    transferRepository,
    /INSERT INTO city_report_values/u,
  );
});


test('project settings module separates update policy from DB storage', async () => {
  const service = await fs.readFile(
    path.join(srcRoot, 'modules', 'project', 'settings-service.js'),
    'utf8',
  );
  const policy = await fs.readFile(
    path.join(srcRoot, 'modules', 'project', 'settings-update-policy.js'),
    'utf8',
  );
  const storage = await fs.readFile(
    path.join(srcRoot, 'db', 'project-settings-storage-repository.js'),
    'utf8',
  );

  assert.match(service, /normalizeProjectSettingsUpdate\(/u);
  assert.match(service, /storage\.updateSettings\(/u);
  assert.match(service, /recalculateStatistics\(/u);
  assert.doesNotMatch(service, /UPDATE project_settings/u);
  assert.doesNotMatch(service, /\.\.\/\.\.\/db\//u);

  assert.match(policy, /buildProjectSettingsPlan\(/u);
  assert.match(policy, /normalizePublicThemePreset\(/u);
  assert.doesNotMatch(policy, /UPDATE project_settings/u);

  assert.match(storage, /SELECT[\s\S]*FROM project_settings/u);
  assert.match(storage, /UPDATE project_settings/u);
  assert.doesNotMatch(storage, /buildProjectSettingsPlan/u);
});

test('legacy project settings repository is only a DB composition adapter', async () => {
  const adapter = await fs.readFile(
    path.join(srcRoot, 'db', 'project-settings-repository.js'),
    'utf8',
  );
  const service = await fs.readFile(
    path.join(srcRoot, 'modules', 'project', 'settings-service.js'),
    'utf8',
  );

  assert.match(adapter, /createProjectSettingsService\(/u);
  assert.match(adapter, /createProjectSettingsStorageRepository\(/u);
  assert.match(adapter, /acquireDataImportLock/u);
  assert.match(adapter, /RECALCULATE_CITY_STATISTICS_SQL/u);
  assert.doesNotMatch(adapter, /UPDATE project_settings/u);
  assert.doesNotMatch(adapter, /buildProjectSettingsPlan/u);

  assert.match(service, /storage\.get\(database\)/u);
  assert.match(service, /storage\.updateSettings\(/u);
  assert.match(service, /storage\.updateCityMarkerIcon\(/u);
});


test('portable export application service separates JSON framing from DB storage', async () => {
  const service = await fs.readFile(
    path.join(
      srcRoot,
      'application',
      'data-transfer',
      'export-service.js',
    ),
    'utf8',
  );
  const storage = await fs.readFile(
    path.join(srcRoot, 'db', 'data-export-storage-repository.js'),
    'utf8',
  );

  assert.match(service, /streamCityBoundaries/u);
  assert.match(service, /streamPopulationRegions/u);
  assert.match(service, /storage\.streamLineItems\(/u);
  assert.match(service, /schemaVersion":3/u);
  assert.doesNotMatch(service, /DECLARE portable_/u);
  assert.doesNotMatch(service, /ST_AsGeoJSON/u);
  assert.doesNotMatch(service, /WITH RECURSIVE ancestry/u);

  assert.match(storage, /DECLARE \$\{cursorName\} NO SCROLL CURSOR/u);
  assert.match(storage, /ST_AsGeoJSON/u);
  assert.match(storage, /WITH RECURSIVE ancestry/u);
  assert.doesNotMatch(storage, /createDataExportService/u);
});

test('legacy data export repository is only a DB composition adapter', async () => {
  const adapter = await fs.readFile(
    path.join(srcRoot, 'db', 'data-export-repository.js'),
    'utf8',
  );
  const service = await fs.readFile(
    path.join(
      srcRoot,
      'application',
      'data-transfer',
      'export-service.js',
    ),
    'utf8',
  );

  assert.match(adapter, /createDataExportService\(database,/u);
  assert.match(adapter, /createDataExportStorageRepository\(/u);
  assert.doesNotMatch(adapter, /ST_AsGeoJSON/u);
  assert.doesNotMatch(adapter, /WITH RECURSIVE ancestry/u);
  assert.doesNotMatch(adapter, /streamPopulationRegions/u);

  assert.match(service, /storage\.exportCityBoundaries\(/u);
  assert.match(service, /storage\.populationRows\(/u);
});
