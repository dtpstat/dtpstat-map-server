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
    /'\/admin\/geometry-editor\/topology\/union-preview'/u,
  );
  assert.match(
    route,
    /'\/admin\/geometry-editor\/topology\/cut-preview'/u,
  );
  assert.match(
    route,
    /'\/admin\/geometry-editor\/topology\/split-preview'/u,
  );
  assert.doesNotMatch(
    route,
    /'\/admin\/geometry-editor\/geometries\/:geometryId\/(?:cut|split)'/u,
  );
  assert.match(
    storage,
    /ST_UnaryUnion/u,
  );
  assert.match(
    storage,
    /WHEN \$2::text = 'line'[\s\S]*ST_RemoveRepeatedPoints\([\s\S]*ST_LineMerge\([\s\S]*ST_UnaryUnion[\s\S]*0\.0/u,
  );
  assert.doesNotMatch(
    storage,
    /WHEN \$2::text = 'line' THEN[\s\S]{0,80}ST_Multi/u,
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
    /\.previewCut\([\s\S]*request\.body/u,
  );
  assert.match(
    route,
    /\.previewSplit\([\s\S]*request\.body/u,
  );
  assert.match(
    route,
    /\.previewUnion\([\s\S]*request\.body/u,
  );
  assert.match(
    service,
    /async previewUnion\([\s\S]*storage\.previewUnion/u,
  );
  assert.match(
    service,
    /async previewCut\([\s\S]*storage\.previewCut/u,
  );
  assert.match(
    service,
    /async previewSplit\([\s\S]*storage\.previewSplit/u,
  );
  assert.doesNotMatch(
    service,
    /async (?:merge|cut|split)\(/u,
  );
  assert.match(
    service,
    /async delete\([\s\S]*normalizeGeometryEditToken[\s\S]*requireOwnedEditLease/u,
  );
});


test('geometry sync can atomically clone immutable metadata for split-created drafts', async () => {
  const [
    policy,
    service,
    storage,
  ] =
    await Promise.all([
      read(
        'src/modules/geometry/editor-policy.js',
      ),
      read(
        'src/modules/geometry/editor-service.js',
      ),
      read(
        'src/db/geometry-editor-storage.js',
      ),
    ]);

  assert.match(
    policy,
    /sourceGeometryId/u,
  );
  assert.match(
    service,
    /sourceGeometryId must reference an update in the same sync request/u,
  );
  assert.match(
    service,
    /createGeometryFromSource/u,
  );
  assert.match(
    storage,
    /CREATE_GEOMETRY_FROM_SOURCE_SQL[\s\S]*source\.properties[\s\S]*source\.source_tags/u,
  );
});


test('split blade extension is compatible with PostGIS installations without ST_LineExtend', async () => {
  const storage =
    await read(
      'src/db/geometry-editor-storage.js',
    );

  assert.doesNotMatch(
    storage,
    /ST_LineExtend/u,
  );
  assert.match(
    storage,
    /ST_StartPoint[\s\S]*ST_EndPoint[\s\S]*ST_MakeLine[\s\S]*1000\.0/u,
  );
});


test('split preview detects a real split by source component-count growth', async () => {
  const [
    storage,
    service,
  ] =
    await Promise.all([
      read(
        'src/db/geometry-editor-storage.js',
      ),
      read(
        'src/modules/geometry/editor-service.js',
      ),
    ]);

  assert.match(
    storage,
    /ST_NumGeometries[\s\S]*source_part_count[\s\S]*part_count >[\s\S]*source_part_count/u,
  );
  assert.doesNotMatch(
    storage,
    /part_count = 2/u,
  );
  assert.match(
    service,
    /geometries\.length < 2/u,
  );
  assert.doesNotMatch(
    service,
    /exactly two valid parts/u,
  );
});


test('topology API hides internal PostGIS errors from the admin UI', async () => {
  const route =
    await read(
      'src/routes/geometry-editor-api.js',
    );

  assert.match(
    route,
    /function topologyError\([\s\S]*Запрошенная операция не выполнена/u,
  );
  assert.match(
    route,
    /console\.error\([\s\S]*Geometry topology operation failed/u,
  );
  assert.match(
    route,
    /topologyError\([\s\S]*'union-preview'/u,
  );
  assert.match(
    route,
    /topologyError\([\s\S]*'cut-preview'/u,
  );
  assert.match(
    route,
    /topologyError\([\s\S]*'split-preview'/u,
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
    /normalizeGeometryUnionPreviewRequest/u,
  );
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
    /async previewUnion\(/u,
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
    /UNION_GEOMETRY_PREVIEW_SQL[\s\S]*ST_UnaryUnion/u,
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
    /\/topology\/union-preview/u,
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
    /geometries/u,
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


test('geometry sync owns deletion persistence while topology transforms stay pure', async () => {
  const [
    policy,
    service,
    storage,
  ] =
    await Promise.all([
      read(
        'src/modules/geometry/editor-policy.js',
      ),
      read(
        'src/modules/geometry/editor-service.js',
      ),
      read(
        'src/db/geometry-editor-storage.js',
      ),
    ]);

  assert.match(
    policy,
    /entry\.kind ===[\s\S]*'delete'[\s\S]*baseUpdatedAt[\s\S]*editToken/u,
  );
  assert.match(
    service,
    /const deletes =[\s\S]*item\.kind ===[\s\S]*'delete'/u,
  );
  assert.match(
    service,
    /const item of deletes[\s\S]*deleteGeometry/u,
  );
  assert.doesNotMatch(
    storage,
    /MERGE_GEOMETRIES_SQL/u,
  );
});


test('geometry storage persists zoom and validity windows as typed parameters', async () => {
  const storage =
    await read(
      'src/db/geometry-editor-storage.js',
    );

  assert.match(
    storage,
    /min_zoom::double precision AS "minZoom"/u,
  );
  assert.match(
    storage,
    /valid_from::text AS "validFrom"/u,
  );
  assert.match(
    storage,
    /UPDATE_GEOMETRY_DISPLAY_WINDOW_SQL[\s\S]*min_zoom = \$2::double precision[\s\S]*valid_to = \$5::date/u,
  );
});


test('geometry discussions are persistent, permission-protected and realtime after persistence', async () => {
  const [
    migration,
    storage,
    leaseStorage,
    policy,
    service,
    runtime,
    route,
    contracts,
  ] =
    await Promise.all([
      Promise.all([
        read('db/migrations/V058__geometry_discussions.sql'),
        read('db/migrations/V062__geometry_discussion_read_state.sql'),
      ]),
      read('src/db/geometry-discussion-storage.js'),
      read('src/db/geometry-edit-lease-storage.js'),
      read('src/modules/geometry/editor-policy.js'),
      read('src/modules/geometry/editor-service.js'),
      read('src/application/geometry-editor-runtime.js'),
      read('src/routes/geometry-editor-api.js'),
      read('src/http/api-request-contract.js'),
    ]);

  const [
    messageMigration,
    readMigration,
  ] = migration;

  assert.match(
    messageMigration,
    /CREATE TABLE IF NOT EXISTS BUSLANES\.GEOMETRY_DISCUSSION_MESSAGES/u,
  );
  assert.match(
    readMigration,
    /CREATE TABLE IF NOT EXISTS BUSLANES\.GEOMETRY_DISCUSSION_READ_STATE/u,
  );
  assert.match(
    messageMigration,
    /GEOMETRY_ID[\s\S]*REFERENCES BUSLANES\.CITY_GEOMETRIES[\s\S]*ON DELETE CASCADE/u,
  );
  assert.match(
    messageMigration,
    /AUTHOR_USER_ID[\s\S]*REFERENCES BUSLANES\.ADMIN_USERS[\s\S]*ON DELETE SET NULL/u,
  );
  assert.match(
    messageMigration,
    /GEOMETRY_REVISION TIMESTAMPTZ/u,
  );

  assert.match(
    storage,
    /INSERT INTO geometry_discussion_messages[\s\S]*geometry\.updated_at[\s\S]*RETURNING id::integer AS id/u,
  );
  assert.match(
    storage,
    /ORDER BY message\.id DESC[\s\S]*LIMIT \$2::integer/u,
  );
  assert.match(
    leaseStorage,
    /user_account\.display_name AS "displayName"/u,
  );
  assert.match(
    leaseStorage,
    /avatar_data IS NOT NULL/u,
  );
  assert.match(
    policy,
    /normalizeGeometryDiscussionMessage/u,
  );
  assert.match(
    service,
    /async postDiscussionMessage\(/u,
  );
  assert.match(
    service,
    /async listDiscussion\(/u,
  );
  assert.match(
    runtime,
    /createGeometryDiscussionStorage/u,
  );
  assert.match(
    route,
    /\/geometries\/:geometryId\/discussion/u,
  );
  assert.match(
    route,
    /resource:\s*'geometry-discussions'[\s\S]*discussionMessage/u,
  );
  assert.match(
    route,
    /\/admin\/geometry-editor\/discussions\/unread/u,
  );
  assert.match(
    route,
    /\/geometries\/:geometryId\/discussion\/read[\s\S]*action:[\s\S]*'read'/u,
  );
  assert.match(
    storage,
    /async unreadCounts\([\s\S]*author_user_id IS DISTINCT FROM \$1::bigint/u,
  );
  assert.match(
    storage,
    /async markRead\([\s\S]*ON CONFLICT \(geometry_id, user_id\)/u,
  );
  assert.match(
    service,
    /async listDiscussionUnread\(/u,
  );
  assert.match(
    service,
    /async markDiscussionRead\(/u,
  );
  assert.match(
    contracts,
    /'\/admin\/geometry-editor\/geometries\/:geometryId\/discussion'[\s\S]*bodyKeys:[\s\S]*'message'/u,
  );
  assert.match(
    contracts,
    /'\/admin\/geometry-editor\/discussions\/unread'/u,
  );
  assert.match(
    contracts,
    /'\/admin\/geometry-editor\/geometries\/:geometryId\/discussion\/read'[\s\S]*'messageId'/u,
  );
});
