import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function source(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('runtime metadata and admin download names are project-neutral', async () => {
  const [
    packageJson,
    apiRoutes,
    transferExports,
    kmlApi,
    compose,
  ] = await Promise.all([
    source('package.json'),
    source('src/routes/api.js'),
    source(
      'src/application/data-transfer/export-routes.js',
    ),
    source('src/routes/kml/export-routes.js'),
    source('compose.yaml'),
  ]);

  assert.equal(JSON.parse(packageJson).name, 'dtpstat-map-server');
  assert.doesNotMatch(
    apiRoutes,
    /dtpstat-buslines-(?:cities|lines|populations)/,
  );
  assert.doesNotMatch(
    transferExports,
    /dtpstat-buslines-(?:cities|lines|populations)/,
  );
  assert.doesNotMatch(
    apiRoutes,
    /'cities\.geojson'|'lines\.geojson'|'populations\.json'/,
  );
  assert.match(
    apiRoutes,
    /data-transfer\/export-routes\.js/,
  );
  assert.match(
    transferExports,
    /'cities\.geojson'/,
  );
  assert.match(
    transferExports,
    /'lines\.geojson'/,
  );
  assert.match(
    transferExports,
    /'populations\.json'/,
  );
  assert.doesNotMatch(kmlApi, /dtpstat-buslines-lines\.kml/);
  assert.match(kmlApi, /filename="lines\.kml"/);
  assert.doesNotMatch(compose, /buslines-postgres/);
});
