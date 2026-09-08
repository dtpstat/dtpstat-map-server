import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => fs.readFile(path.join(projectRoot, file), 'utf8');

test('admin exposes portable KML import/export and distinguishes business type from geometry type', async () => {
  const [shell, editor] = await Promise.all([
    source('admin/admin-shell.js'),
    source('admin/kml-transfer-editor.js'),
  ]);

  assert.match(shell, /await import\('\.\/kml-transfer-editor\.js'\)/);
  assert.match(editor, /\/api\/admin\/export\/lines\.kml/);
  assert.match(editor, /\/api\/admin\/import\/lines\.kml/);
  assert.match(editor, /businessTypeCode/);
  assert.match(editor, /type — NAME бизнес-типа из источника/);
  assert.match(editor, /CODE назначает БД/);
  assert.match(editor, /TITLE сначала равен NAME/);
  assert.match(editor, /LineString\/MultiLineString/);
  assert.match(editor, /code\/name\/title\/color\/style\/width/);
});
