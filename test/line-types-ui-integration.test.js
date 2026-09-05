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

test('admin groups data by entity and exposes operation-level tabs', async () => {
  const [html, admin, css] = await Promise.all([
    source('admin/index.html'),
    source('admin/admin.js'),
    source('admin/admin.css'),
  ]);

  assert.match(html, />\s*Города\s*</);
  assert.match(html, />\s*Линии данных\s*</);
  assert.match(html, />\s*Население\s*</);
  for (const operation of [
    'osm-update',
    'osm-geojson',
    'kml-external',
    'kml-geojson',
    'kml-types',
    'population-json',
  ]) {
    assert.match(html, new RegExp(`data-operation-tab="${operation}"`));
    assert.match(html, new RegExp(`data-operation-panel="${operation}"`));
  }
  assert.match(admin, /'osm-city-update': 'osm-update'/);
  assert.match(admin, /'city-geojson-import': 'osm-geojson'/);
  assert.match(admin, /'kml-update': 'kml-external'/);
  assert.match(admin, /'geojson-import': 'kml-geojson'/);
  assert.match(admin, /selectOperation\(activeOperation\)/);
  assert.match(css, /\.operation-tabs \{/);
});

test('successful-update timestamps stay inside their operation blocks', async () => {
  const [html, css] = await Promise.all([
    source('admin/index.html'),
    source('admin/admin.css'),
  ]);

  for (const taskType of [
    'osm-city-update',
    'city-geojson-import',
    'kml-update',
    'geojson-import',
    'population-update',
  ]) {
    assert.match(
      html,
      new RegExp(`class="last-success" data-last-success="${taskType}"`),
    );
  }
  assert.match(css, /\.last-success \{/);
  assert.doesNotMatch(css, /\.task-panel\s*>\s*\.last-success/);
});

test('admin line type operation connects the style editor and documents KML type', async () => {
  const [html, editor] = await Promise.all([
    source('admin/index.html'),
    source('admin/line-types-editor.js'),
  ]);

  assert.match(html, /src="\/admin\/line-types-editor\.js"/);
  assert.match(html, /href="\/admin\/line-types\.css"/);
  assert.match(html, /id="line-types-editor-host"/);
  assert.match(html, /"multiple":1,"type":"default"/);
  assert.match(editor, /querySelector\('#line-types-editor-host'\)/);
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
