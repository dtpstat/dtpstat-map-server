import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('portable transfer UI offers ZIP and uploads selected files without file.text buffering', async () => {
  const [html, admin, styles] = await Promise.all([
    read('admin/index.html'),
    read('admin/admin.js'),
    read('admin/admin.css'),
  ]);

  assert.match(html, /href="\/api\/admin\/export\/cities\.zip"/);
  assert.match(html, /href="\/api\/admin\/export\/lines\.zip"/);
  assert.match(html, /href="\/api\/admin\/export\/populations\.zip"/);
  assert.match(
    html,
    /accept="[^"]*\.zip[^"]*application\/zip/,
  );

  assert.match(admin, /function portableFileOptions\(file, jsonContentType\)/);
  assert.match(admin, /body:\s*file/);
  assert.match(admin, /'application\/zip'/);
  assert.match(
    admin,
    /importGeoJsonFile[\s\S]*portableFileOptions\(file, 'application\/geo\+json'\)/,
  );

  const geoJsonImport = admin.match(
    /async function importGeoJsonFile[\s\S]*?\n}/,
  )?.[0] ?? '';
  assert.doesNotMatch(geoJsonImport, /file\.text\(/);

  const populationHandler = admin.match(
    /elements\.populationForm\.addEventListener[\s\S]*?\n}\);/,
  )?.[0] ?? '';
  assert.match(populationHandler, /portableFileOptions\(file, 'application\/json'\)/);
  assert.doesNotMatch(populationHandler, /file\.text\(/);

  assert.match(styles, /\.transfer-links\s*\{/);
});
