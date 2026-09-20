import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('OSM object editor is a top-level admin section with population editing', async () => {
  const [html, shell, editor, styles] = await Promise.all([
    read('admin/index.html'),
    read('admin/admin-shell.js'),
    read('admin/osm-boundary-editor.js'),
    read('admin/osm-boundary-editor.css'),
  ]);

  assert.match(
    html,
    /data-admin-section-tab="osm-objects"[\s\S]*aria-controls="admin-section-osm-objects"/,
  );
  assert.match(
    html,
    /id="admin-section-osm-objects"[\s\S]*id="osm-boundary-map"/,
  );
  assert.match(
    html,
    /id="osm-boundary-search"[\s\S]*id="osm-boundary-tree"[\s\S]*id="osm-boundary-map"[\s\S]*id="osm-boundary-form"/,
  );
  assert.match(
    html,
    /id="osm-boundary-search"[^>]*type="search"[^>]*placeholder="Название, тип, OSM ID…"/,
  );
  assert.match(
    html,
    /name="population"[^>]*type="number"[^>]*max="2147483647"/,
  );
  assert.match(
    html,
    /name="population"[\s\S]*<button type="submit" disabled>Сохранить объект<\/button>[\s\S]*id="osm-boundary-meta"/,
  );
  assert.doesNotMatch(html, /data-operation-tab="osm-objects"/);
  assert.doesNotMatch(html, /data-operation-panel="osm-objects"/);

  assert.match(shell, /'osm-objects': dataAccess/);
  assert.match(shell, /dtpstat:osm-boundary-editor-open/);
  assert.match(editor, /#admin-section-osm-objects/);
  assert.match(editor, /population\.dataset\.initialValue/);
  assert.match(editor, /changes\.population/);
  assert.match(editor, /function normalizeSearchText\(value\)/);
  assert.match(editor, /\.toLocaleLowerCase\('ru-RU'\)[\s\S]*\.replace\(\/\\s\+\/gu, ''\)/);
  assert.match(editor, /function compareBoundaries\(a, b\)/);
  assert.doesNotMatch(editor, /Number\(b\.active\) - Number\(a\.active\)/);
  assert.match(
    editor,
    /compareText\(a\.displayName, b\.displayName\)[\s\S]*compareText\(a\.displayType, b\.displayType\)/,
  );
  assert.match(
    editor,
    /if \(!boundarySearchText\(item\)\.includes\(query\)\) continue;[\s\S]*current = byId\.get\(current\.parentId\)/,
  );
  assert.match(editor, /searchInput\.addEventListener\('input', \(\) => renderTree\(\)\)/);
  assert.match(
    editor,
    /https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/,
  );
  assert.doesNotMatch(editor, /\{s\}\.tile\.openstreetmap\.org/);
  assert.match(editor, /openstreetmap\.org\/copyright/);
  assert.match(
    styles,
    /grid-template-columns:\s*minmax\(19rem, \.72fr\)[\s\S]*minmax\(30rem, 1\.8fr\)[\s\S]*minmax\(20rem, \.82fr\)/,
  );
  assert.match(styles, /#osm-boundary-form[\s\S]*flex-direction:\s*column/);
  assert.match(styles, /\.osm-boundary-tree-panel[\s\S]*flex-direction:\s*column/);
  assert.match(styles, /\.osm-boundary-tree[\s\S]*overflow:\s*auto/);
});
