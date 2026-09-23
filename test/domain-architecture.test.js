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
        !resolved || !resolved.startsWith(path.join(srcRoot, 'routes') + path.sep),
        `${path.relative(root, file)} must not depend on legacy src/routes`,
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
    path.join(srcRoot, 'db', 'osm-city-update-service.js'),
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


test('OSM update facade delegates checkpoint compatibility policy to the module', async () => {
  const source = await fs.readFile(
    path.join(srcRoot, 'db', 'osm-city-update-service.js'),
    'utf8',
  );
  const policy = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-checkpoint-policy.js'),
    'utf8',
  );

  assert.match(source, /checkpointSettingsFingerprint\(options\)/u);
  assert.match(source, /checkpointCompletionChecksum\(/u);
  assert.doesNotMatch(source, /function checkpointMode\(/u);
  assert.doesNotMatch(source, /function checkpointOptionSnapshot\(/u);
  assert.match(policy, /export function checkpointMode\(/u);
  assert.match(policy, /export function checkpointOptionSnapshot\(/u);
  assert.match(policy, /export function checkpointCompletionChecksum\(/u);
});


test('OSM update facade delegates boundary persistence to repository', async () => {
  const source = await fs.readFile(
    path.join(srcRoot, 'db', 'osm-city-update-service.js'),
    'utf8',
  );
  const repository = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'boundary-update-repository.js'),
    'utf8',
  );

  assert.match(source, /createOsmBoundaryUpdateRepository\(/u);
  assert.match(source, /boundaryUpdateRepository\.stageBatch\(/u);
  assert.match(source, /boundaryUpdateRepository\.insertBoundaries\(/u);
  assert.doesNotMatch(source, /INSERT INTO city_boundaries/u);
  assert.doesNotMatch(source, /osm_city_boundary_stage/u);
  assert.match(repository, /INSERT INTO city_boundaries/u);
  assert.match(repository, /osm_city_boundary_stage/u);
});


test('OSM update facade delegates index composition and batch policy', async () => {
  const source = await fs.readFile(
    path.join(srcRoot, 'db', 'osm-city-update-service.js'),
    'utf8',
  );
  const indexSession = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-index-session.js'),
    'utf8',
  );
  const batchPolicy = await fs.readFile(
    path.join(srcRoot, 'modules', 'osm', 'update-batch-policy.js'),
    'utf8',
  );

  assert.match(source, /loadOsmUpdateIndex\(/u);
  assert.match(source, /createObjectBatches\(/u);
  assert.doesNotMatch(source, /function combineIndexParts\(/u);
  assert.doesNotMatch(source, /buildRussianPlaceIdOverpassQueries/u);
  assert.match(indexSession, /buildRussianPlaceIdOverpassQueries\(/u);
  assert.match(indexSession, /combineIndexParts\(/u);
  assert.match(batchPolicy, /export function assertCompleteBatch\(/u);
  assert.match(batchPolicy, /export function createObjectBatches\(/u);
});
