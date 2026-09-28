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

test('mobile city navigation keeps map selection on the map and table selection reveals the map', async () => {
  const [publicApp, publicCss] = await Promise.all([
    source('public/js/app.js'),
    source('public/css/app.css'),
  ]);

  assert.match(
    publicApp,
    /function selectCity\(city, \{ revealMap = false \} = \{\}\)/,
  );
  assert.match(publicApp, /cityList\.select\(city\.id\);/);
  assert.match(
    publicApp,
    /if \(revealMap\) mapPanel\.scrollIntoView\(\{ block: 'start' \}\);/,
  );
  assert.match(
    publicApp,
    /cityList\.onSelect\(\(city\) => selectCity\(city, \{ revealMap: true \}\)\);/,
  );
  assert.match(
    publicApp,
    /mapController\.onCitySelect\(\(cityId\) => \{[\s\S]*?if \(city\) selectCity\(city\);[\s\S]*?\}\);/,
  );
  assert.match(publicApp, /cityList\.select\(centerCity\?\.id \?\? null\);/);
  assert.doesNotMatch(publicApp, /scrollIntoView: Boolean\(centerCity\)/);

  assert.match(
    publicCss,
    /@media \(max-width: 760px\)[\s\S]*?\.map-panel \{[\s\S]*?height: 100vh;[\s\S]*?height: 100dvh;[\s\S]*?min-height: 100dvh;/,
  );
});
