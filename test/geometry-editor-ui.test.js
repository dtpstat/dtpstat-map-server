import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');

test('geometry editor is an independent top-level role-protected admin section', async () => {
  const [html, shell, editor, styles] = await Promise.all([
    read('admin/index.html'),
    read('admin/admin-shell.js'),
    read('admin/geometry-editor.js'),
    read('admin/geometry-editor.css'),
  ]);

  assert.match(html, /data-admin-section-tab="geometries"[\s\S]*aria-controls="admin-section-geometries"/);
  assert.match(html, /id="admin-section-geometries"[\s\S]*id="geometry-editor-map"/);
  assert.match(html, /id="geometry-editor-list"[\s\S]*id="geometry-editor-map"[\s\S]*id="geometry-editor-form"/);
  assert.match(shell, /geometries:[\s\S]*canEditGeometries/);
  assert.match(shell, /if \(canEditGeometries\(user\)\) await import\('\.\/geometry-editor\.js'\)/);
  assert.match(shell, /dtpstat:geometry-editor-open/);

  assert.match(editor, /geometry-editor\/cities/);
  assert.match(editor, /geometry-editor\/geometries/);
  assert.match(editor, /function editableSequences\(geometry\)/);
  assert.match(editor, /kind: 'midpoint'/);
  assert.match(editor, /map\.on\('mousedown', 'geometry-editor-vertices'/);
  assert.match(editor, /insertMidpoint/);
  assert.match(editor, /deleteSelectedVertex/);
  assert.match(editor, /state\.history\.length > 50/);
  assert.match(editor, /geometry-editor\/merge/);
  assert.match(editor, /\/cut/);
  assert.match(editor, /window\.confirm/);

  assert.match(styles, /grid-template-columns:\s*minmax\(19rem, \.72fr\)[\s\S]*minmax\(30rem, 1\.8fr\)[\s\S]*minmax\(20rem, \.82fr\)/);
  assert.match(styles, /\.geometry-editor-list[\s\S]*overflow:\s*auto/);
  assert.match(styles, /\.geometry-editor-details[\s\S]*overflow-y:\s*auto/);
});

test('geometry editor attribute form exposes visibility tags line fields and polygon cut', async () => {
  const html = await read('admin/index.html');

  assert.match(html, /name="displayName"/);
  assert.match(html, /name="tooltip"/);
  assert.match(html, /name="tags"/);
  assert.match(html, /name="isVisible"/);
  assert.match(html, /name="lineTypeId"/);
  assert.match(html, /name="lanes"/);
  assert.match(html, /id="geometry-cut-area"/);
  assert.match(html, /id="geometry-delete"/);
  assert.match(html, /id="geometry-new-point"/);
  assert.match(html, /id="geometry-new-line"/);
  assert.match(html, /id="geometry-new-polygon"/);
});


test('geometry editor exposes visual staged-import conflict decisions', async () => {
  const [html, editor] = await Promise.all([
    read('admin/index.html'),
    read('admin/geometry-editor.js'),
  ]);
  assert.match(html, /id="geometry-import-conflicts"/);
  assert.match(html, /id="geometry-conflict-candidates"/);
  assert.match(html, /id="geometry-conflict-keep"/);
  assert.match(html, /id="geometry-conflict-add"/);
  assert.match(html, /id="geometry-conflict-replace"/);
  assert.match(editor, /geometry-import\/pending/);
  assert.match(editor, /keep-existing/);
  assert.match(editor, /add-new/);
  assert.match(editor, /replaceExistingIds/);
  assert.match(editor, /geometry-editor-import-incoming/);
  assert.match(editor, /geometry-editor-import-existing/);
});


test('geometry editor explains an actually empty active-city catalog', async () => {
  const editor = await read('admin/geometry-editor.js');
  assert.match(editor, /Нет активных городов в OSM-дереве/);
  assert.match(editor, /Проверьте активность объектов в OSM-дереве/);
  assert.match(editor, /cityLinkState/);
});


test('geometry editor loads data progressively instead of one global catalog request', async () => {
  const editor = await read('admin/geometry-editor.js');

  assert.match(editor, /async function loadCities\(\)/);
  assert.match(editor, /\/geometry-editor\/cities\/\$\{encodeURIComponent\(cityId\)\}\/geometries/);
  assert.match(editor, /\/geometry-editor\/geometries\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(editor, /async function ensureLineTypes\(\)/);
  assert.match(editor, /api\('\/api\/line-types'\)/);
  assert.doesNotMatch(editor, /payload\.tags/);
  assert.doesNotMatch(editor, /payload\.lineTypes[\s\S]{0,200}geometry-editor\/cities/);
});
