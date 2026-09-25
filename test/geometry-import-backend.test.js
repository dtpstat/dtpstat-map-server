import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';

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

test('geometry import conflict storage uses explicit equals within overlaps relations', async () => {
  const storage =
    await read(
      'src/db/geometry-import-storage.js',
    );

  assert.match(
    storage,
    /ST_Equals\(existing\.geom, stage\.geom\)[\s\S]*source_tags IS DISTINCT FROM stage\.source_tags/u,
  );
  assert.match(
    storage,
    /ST_Overlaps\(existing\.geom, stage\.geom\)/u,
  );
  assert.match(
    storage,
    /ST_Within\(existing\.geom, stage\.geom\)[\s\S]*ST_Within\(stage\.geom, existing\.geom\)/u,
  );
  assert.doesNotMatch(
    storage,
    /ST_Intersects\(existing\.geom, stage\.geom\)/u,
  );
  assert.match(
    storage,
    /add-new would create a duplicate/u,
  );
  assert.match(
    storage,
    /conflictAutoMatched/u,
  );
});

test('staged KML conflict backend is wired through runtime routes and portable-import guard', async () => {
  const [
    runtime,
    routes,
    api,
    kml,
    portableImport,
  ] =
    await Promise.all([
      read(
        'src/application/geometry-import-runtime.js',
      ),
      read(
        'src/modules/geometry/import-routes.js',
      ),
      read(
        'src/routes/api.js',
      ),
      read(
        'src/modules/lines/kml-update-service.js',
      ),
      read(
        'src/modules/lines/import-service.js',
      ),
    ]);

  assert.match(
    runtime,
    /createGeometryImportService/u,
  );
  assert.match(
    routes,
    /'\/admin\/geometry-import\/pending'/u,
  );
  assert.match(
    routes,
    /'\/admin\/geometry-import\/:sessionId\/apply'/u,
  );
  assert.match(
    routes,
    /requireGeometryEditor/u,
  );
  assert.match(
    api,
    /registerGeometryImportRoutes/u,
  );
  assert.match(
    kml,
    /geometryImportService[\s\S]*stageKml/u,
  );
  assert.match(
    kml,
    /pendingResolution:\s*true/u,
  );
  assert.match(
    portableImport,
    /assertNoPendingGeometryImport/u,
  );
});


test('geometry editors can poll only geometry-import task status without broad data permission', async () => {
  const [
    routes,
    api,
  ] =
    await Promise.all([
      read(
        'src/modules/geometry/import-routes.js',
      ),
      read(
        'src/routes/api.js',
      ),
    ]);

  assert.match(
    routes,
    /'\/admin\/geometry-import\/tasks\/:taskId'/u,
  );
  assert.match(
    routes,
    /requireGeometryEditor/u,
  );
  assert.match(
    routes,
    /task\?\.type ===\s*'kml-update'/u,
  );
  assert.match(
    routes,
    /geometry-import\\\/\\d\+\\\/apply/u,
  );
  assert.doesNotMatch(
    routes,
    /requireData/u,
  );
  assert.match(
    api,
    /registerGeometryImportRoutes\([\s\S]*adminTasks/u,
  );
});
