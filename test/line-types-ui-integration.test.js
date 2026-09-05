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

test('line type migration creates a default type and mandatory geometry link', async () => {
  const sql = await source('db/migrations/V008__line_types.sql');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS BUSLANES\.LINE_TYPES/i);
  assert.match(sql, /VALUES \('default', 'Выделенные полосы'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS LINE_TYPE_ID BIGINT/i);
  assert.match(sql, /ALTER COLUMN LINE_TYPE_ID SET NOT NULL/i);
  assert.match(sql, /REFERENCES BUSLANES\.LINE_TYPES \(ID\)/i);
  assert.match(sql, /ON DELETE RESTRICT/i);
});

test('admin line panel connects the style editor and documents KML type', async () => {
  const [html, editor] = await Promise.all([
    source('admin/index.html'),
    source('admin/line-types-editor.js'),
  ]);

  assert.match(html, /src="\/admin\/line-types-editor\.js"/);
  assert.match(html, /"multiple":1,"type":"default"/);
  assert.match(editor, /input\.type = 'color'/);
  assert.match(editor, /\['solid', 'Сплошная'\]/);
  assert.match(editor, /\['dashed', 'Штриховая'\]/);
  assert.match(editor, /\['dotted', 'Точечная'\]/);
  assert.match(editor, /widthInput\.min = '0\.5'/);
  assert.match(editor, /fetch\('\/api\/admin\/line-types'/);
});

test('public client shows a multi-type legend and toggles map layers locally', async () => {
  const app = await source('public/js/app.js');
  const controller = await source('public/js/map-controller.js');

  assert.match(app, /if \(lineTypes\.length <= 1\) return/);
  assert.match(app, /name\.textContent = lineType\.name/);
  assert.match(app, /setLineTypeVisibility\(lineType\.type, enabled\)/);
  assert.match(controller, /filter: \['==', \['get', 'lineType'\], lineType\.type\]/);
  assert.match(controller, /map\.setLayoutProperty\(layerId, 'visibility'/);
});
