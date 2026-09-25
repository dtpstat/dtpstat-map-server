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
