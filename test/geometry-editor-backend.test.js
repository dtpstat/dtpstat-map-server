import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );
const read =
  (relativePath) =>
    fs.readFile(
      path.join(
        root,
        relativePath,
      ),
      'utf8',
    );

test('geometry editor backend follows current policy storage service runtime route layering', async () => {
  const [
    policy,
    storage,
    service,
    runtime,
    route,
    composition,
  ] =
    await Promise.all([
      read('src/modules/geometry/editor-policy.js'),
      read('src/db/geometry-editor-storage.js'),
      read('src/modules/geometry/editor-service.js'),
      read('src/application/geometry-editor-runtime.js'),
      read('src/routes/geometry-editor-api.js'),
      read('src/application/http/api-composition.js'),
    ]);

  assert.match(
    policy,
    /normalizeGeometryBulkUpdates/u,
  );
  assert.match(
    storage,
    /geometry\.updated_at AS "updatedAt"/u,
  );
  assert.doesNotMatch(
    storage,
    /express/u,
  );
  assert.match(
    service,
    /await storage\s*\.lockGeometries/u,
  );
  assert.match(
    service,
    /conflicts\.length > 0/u,
  );
  assert.match(
    runtime,
    /createGeometryEditorStorage/u,
  );
  assert.match(
    runtime,
    /createGeometryEditorService/u,
  );
  assert.match(
    route,
    /requireGeometryEditor/u,
  );
  assert.match(
    route,
    /'\/admin\/geometry-editor\/geometries'/u,
  );
  assert.match(
    route,
    /x-dtpstat-base-revision/u,
  );
  assert.match(
    route,
    /resource:\s*'city-geometries'/u,
  );
  assert.match(
    route,
    /permission:\s*'geometry-editor'/u,
  );
  assert.match(
    route,
    /'\/admin\/geometry-editor\/merge'/u,
  );
  assert.match(
    route,
    /'\/admin\/geometry-editor\/geometries\/:geometryId\/cut'/u,
  );
  assert.match(
    storage,
    /ST_UnaryUnion/u,
  );
  assert.match(
    storage,
    /ST_Difference/u,
  );
  assert.doesNotMatch(
    route,
    /requireData/u,
  );
  assert.match(
    composition,
    /createGeometryEditorRouter/u,
  );
});

test('admin task geometry changes are routed to geometry editors rather than broad data managers', async () => {
  const source =
    await read(
      'src/application/admin-runtime.js',
    );

  const kml =
    source.slice(
      source.indexOf(
        "'kml-update'",
      ),
      source.indexOf(
        "'geojson-import'",
      ),
    );

  assert.match(
    kml,
    /resource: 'city-geometries'/u,
  );
  assert.match(
    kml,
    /permission: 'geometry-editor'/u,
  );
});


test('geometry editor city catalog includes active linked cities before their first geometry', async () => {
  const storage =
    await read(
      'src/db/geometry-editor-storage.js',
    );

  const start =
    storage.indexOf(
      'const CITIES_SQL',
    );
  const end =
    storage.indexOf(
      'const CITY_SQL',
      start,
    );
  const query =
    storage.slice(
      start,
      end,
    );

  assert.match(
    query,
    /FROM city_boundaries AS boundary[\s\S]*boundary\.is_active/u,
  );
  assert.match(
    query,
    /COUNT\(\*\)::integer[\s\S]*AS "geometryCount"/u,
  );
  assert.match(
    query,
    /OR EXISTS \([\s\S]*FROM city_geometries AS geometry_presence[\s\S]*geometry_presence\.city_id = city\.id/u,
  );
  assert.match(
    query,
    /WHERE EXISTS \([\s\S]*FROM city_boundaries AS boundary[\s\S]*boundary\.is_active[\s\S]*\)[\s\S]*OR EXISTS/u,
  );
});


test('geometry editor exposes suspended cities and geometries without an active boundary', async () => {
  const storage =
    await read(
      'src/db/geometry-editor-storage.js',
    );

  const citiesStart =
    storage.indexOf(
      'const CITIES_SQL',
    );
  const cityStart =
    storage.indexOf(
      'const CITY_SQL',
      citiesStart,
    );
  const summariesStart =
    storage.indexOf(
      'const GEOMETRY_SUMMARIES_SQL',
      cityStart,
    );

  const citiesQuery =
    storage.slice(
      citiesStart,
      cityStart,
    );
  const cityQuery =
    storage.slice(
      cityStart,
      summariesStart,
    );

  assert.match(
    citiesQuery,
    /"suspendedGeometryCount"/u,
  );
  assert.match(
    citiesQuery,
    /geometry_presence/u,
  );
  assert.match(
    citiesQuery,
    /"activeBoundaryId"/u,
  );
  assert.match(
    cityQuery,
    /LEFT JOIN LATERAL/u,
  );
  assert.match(
    storage,
    /geometry\.boundary_id IS NULL\) AS suspended/u,
  );
});


test('geometry server model treats administrative links as optional derived state', async () => {
  const [
    migration,
    storage,
    ingestion,
  ] =
    await Promise.all([
      read(
        'db/migrations/V045__spatial_geometry_links.sql',
      ),
      read(
        'src/db/geometry-editor-storage.js',
      ),
      read(
        'src/application/ingestion-database-runtime.js',
      ),
    ]);

  assert.match(
    migration,
    /RESOLVE_GEOMETRY_ADMIN_LINKS/u,
  );
  assert.match(
    migration,
    /ACTIVE_DESCENDANTS/u,
  );
  assert.match(
    migration,
    /MATCHED_MEASURE[\s\S]*BOUNDARY_ID ASC/u,
  );
  assert.match(
    migration,
    /RELINK_ALL_CITY_GEOMETRIES/u,
  );
  assert.doesNotMatch(
    migration,
    /SET[\s\S]*UPDATED_AT = NOW\(\)[\s\S]*BOUNDARY_ID/u,
  );
  assert.match(
    storage,
    /SELECT relink_city_geometry\(\$1::bigint\)/u,
  );
  assert.match(
    ingestion,
    /sync_active_boundary_cities\(\)[\s\S]*relink_all_city_geometries\(\)/u,
  );
});

test('geometry editor backend exposes atomic create-update sync and edit leases', async () => {
  const [
    policy,
    service,
    route,
    runtime,
    leaseStorage,
    migration,
  ] =
    await Promise.all([
      read(
        'src/modules/geometry/editor-policy.js',
      ),
      read(
        'src/modules/geometry/editor-service.js',
      ),
      read(
        'src/routes/geometry-editor-api.js',
      ),
      read(
        'src/application/geometry-editor-runtime.js',
      ),
      read(
        'src/db/geometry-edit-lease-storage.js',
      ),
      read(
        'db/migrations/V046__geometry_edit_leases.sql',
      ),
    ]);

  assert.match(
    policy,
    /normalizeGeometrySyncRequest/u,
  );
  assert.match(
    policy,
    /editToken/u,
  );
  assert.match(
    service,
    /async sync\(/u,
  );
  assert.match(
    service,
    /leaseStorage[\s\S]*\.owns/u,
  );
  assert.match(
    route,
    /'\/admin\/geometry-editor\/sync'/u,
  );
  assert.match(
    route,
    /edit-lock\/heartbeat/u,
  );
  assert.match(
    route,
    /edit-locks\/validate/u,
  );
  assert.match(
    route,
    /edit-lock\/takeover[\s\S]*requireSuperuser/u,
  );
  assert.match(
    route,
    /resource:\s*'geometry-edit-leases'/u,
  );
  assert.match(
    runtime,
    /createGeometryEditLeaseStorage/u,
  );
  assert.match(
    leaseStorage,
    /generation = geometry_edit_leases\.generation \+ 1/u,
  );
  assert.match(
    leaseStorage,
    /expires_at > NOW\(\)[\s\S]*FOR SHARE/u,
  );

  const renewStart =
    leaseStorage.indexOf(
      'async renew(',
    );
  const ownsStart =
    leaseStorage.indexOf(
      'async owns(',
      renewStart,
    );
  const renewSql =
    leaseStorage.slice(
      renewStart,
      ownsStart,
    );

  assert.match(
    renewSql,
    /token = \$2[\s\S]*user_id = \$3/u,
  );
  assert.doesNotMatch(
    renewSql,
    /expires_at > NOW\(\)/u,
  );
  assert.match(
    migration,
    /GEOMETRY_EDIT_LEASES/u,
  );
  assert.match(
    route,
    /\.delete\([\s\S]*editToken:[\s\S]*editToken\([\s\S]*request\.adminUser/u,
  );
  assert.match(
    route,
    /\.cut\([\s\S]*editToken:[\s\S]*editToken\([\s\S]*request\.adminUser/u,
  );
  assert.match(
    route,
    /\.merge\([\s\S]*request\.adminUser[\s\S]*realtimeClientId/u,
  );
  assert.match(
    service,
    /async merge\([\s\S]*leaseStorage[\s\S]*\.acquire[\s\S]*mergeLeaseTokens[\s\S]*\.release/u,
  );
  assert.match(
    service,
    /async cut\([\s\S]*normalizeGeometryEditToken[\s\S]*requireOwnedEditLease/u,
  );
  assert.match(
    service,
    /async delete\([\s\S]*normalizeGeometryEditToken[\s\S]*requireOwnedEditLease/u,
  );
});


test('geometry topology preview stays PostGIS-backed and mutation-free', async () => {
  const [
    policy,
    service,
    storage,
    route,
    contracts,
  ] =
    await Promise.all([
      read(
        'src/modules/geometry/topology-policy.js',
      ),
      read(
        'src/modules/geometry/editor-service.js',
      ),
      read(
        'src/db/geometry-editor-storage.js',
      ),
      read(
        'src/routes/geometry-editor-api.js',
      ),
      read(
        'src/http/api-request-contract.js',
      ),
    ]);

  assert.match(
    policy,
    /normalizeGeometryCutPreviewRequest/u,
  );
  assert.match(
    policy,
    /normalizeGeometrySplitPreviewRequest/u,
  );
  assert.match(
    service,
    /async previewCut\(/u,
  );
  assert.match(
    service,
    /async previewSplit\(/u,
  );
  assert.match(
    storage,
    /CUT_GEOMETRY_PREVIEW_SQL[\s\S]*ST_Difference/u,
  );
  assert.match(
    storage,
    /SPLIT_GEOMETRY_PREVIEW_SQL[\s\S]*ST_Split/u,
  );
  assert.match(
    route,
    /\/topology\/cut-preview/u,
  );
  assert.match(
    route,
    /\/topology\/split-preview/u,
  );
  assert.match(
    contracts,
    /sourceGeometry[\s\S]*cutterGeometry/u,
  );
  assert.match(
    contracts,
    /sourceGeometry[\s\S]*blade/u,
  );
});


test('geometry topology operations stay domain validated revision safe and transactional', async () => {
  const [
    policy,
    service,
    storage,
    route,
    contracts,
  ] = await Promise.all([
    read(
      'src/modules/geometry/topology-policy.js',
    ),
    read(
      'src/modules/geometry/editor-service.js',
    ),
    read(
      'src/db/geometry-editor-storage.js',
    ),
    read(
      'src/routes/geometry-editor-api.js',
    ),
    read(
      'src/http/api-request-contract.js',
    ),
  ]);

  assert.match(
    policy,
    /normalizeGeometryCutRequest/u,
  );
  assert.match(
    policy,
    /normalizeGeometrySplitRequest/u,
  );
  assert.match(
    policy,
    /exactly one cutter source/u,
  );
  assert.match(
    service,
    /async split\(/u,
  );
  assert.match(
    service,
    /Geometry changed before split/u,
  );
  assert.match(
    service,
    /requireOwnedEditLease/u,
  );
  assert.match(
    service,
    /Cutter geometry changed before cut/u,
  );
  assert.match(
    storage,
    /ST_Split/u,
  );
  assert.match(
    storage,
    /ST_LineExtend/u,
  );
  assert.match(
    storage,
    /part\.part_count = 2/u,
  );
  assert.match(
    storage,
    /INSERT INTO city_geometries/u,
  );
  assert.match(
    route,
    /'\/admin\/geometry-editor\/geometries\/:geometryId\/split'/u,
  );
  assert.match(
    route,
    /audit\([\s\S]*'geometry\.split'/u,
  );
  assert.match(
    contracts,
    /cutterGeometryId/u,
  );
  assert.match(
    contracts,
    /cutterUpdatedAt/u,
  );
  assert.match(
    contracts,
    /'\/admin\/geometry-editor\/geometries\/:geometryId\/split'[\s\S]*'blade'[\s\S]*x-dtpstat-edit-token/u,
  );
});
