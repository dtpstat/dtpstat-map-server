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

  assert.match(admin, /function portableFileContentType\(file, jsonContentType\)/);
  assert.match(admin, /new XMLHttpRequest\(\)/);
  assert.match(admin, /xhr\.upload\.addEventListener\('progress'/);
  assert.match(admin, /xhr\.send\(file\)/);
  assert.match(admin, /'application\/zip'/);
  assert.match(
    admin,
    /importGeoJsonFile[\s\S]*uploadPortableFile\([\s\S]*'application\/geo\+json'/,
  );

  const geoJsonImport = admin.match(
    /async function importGeoJsonFile[\s\S]*?\n}/,
  )?.[0] ?? '';
  assert.doesNotMatch(geoJsonImport, /file\.text\(/);

  const populationHandler = admin.match(
    /elements\.populationForm\.addEventListener[\s\S]*?\n}\);/,
  )?.[0] ?? '';
  assert.match(populationHandler, /uploadPortableFile\([\s\S]*'application\/json'/);
  assert.doesNotMatch(populationHandler, /file\.text\(/);

  assert.match(admin, /admin-transfer-overlay/);
  assert.match(admin, /beforeunload/);
  assert.match(admin, /fileImportTaskTypes/);
  assert.match(
    admin,
    /applyTask\(payload\.task\);[\s\S]*syncTransferOverlay\(/,
  );
  assert.match(styles, /\.transfer-links\s*\{/);
  assert.match(styles, /\.admin-transfer-overlay\s*\{/);
  assert.match(styles, /body\.admin-transfer-locked/);
});
