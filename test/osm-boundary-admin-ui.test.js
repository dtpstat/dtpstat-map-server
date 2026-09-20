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
  const [html, shell, editor] = await Promise.all([
    read('admin/index.html'),
    read('admin/admin-shell.js'),
    read('admin/osm-boundary-editor.js'),
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
    /name="population"[^>]*type="number"[^>]*max="2147483647"/,
  );
  assert.doesNotMatch(html, /data-operation-tab="osm-objects"/);
  assert.doesNotMatch(html, /data-operation-panel="osm-objects"/);

  assert.match(shell, /'osm-objects': dataAccess/);
  assert.match(shell, /dtpstat:osm-boundary-editor-open/);
  assert.match(editor, /#admin-section-osm-objects/);
  assert.match(editor, /population\.dataset\.initialValue/);
  assert.match(editor, /changes\.population/);
});
