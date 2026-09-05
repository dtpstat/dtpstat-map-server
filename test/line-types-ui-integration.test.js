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

test('line type migrations create FK storage, unique display names and remove redundant property copies', async () => {
  const [baseSql, normalizationSql] = await Promise.all([
    source('db/migrations/V008__line_types.sql'),
    source('db/migrations/V012__line_type_codes_and_unique_names.sql'),
  ]);

  assert.match(baseSql, /CREATE TABLE IF NOT EXISTS BUSLANES\.LINE_TYPES/i);
  assert.match(baseSql, /VALUES \('default', 'Выделенные полосы'/);
  assert.match(baseSql, /ADD COLUMN IF NOT EXISTS LINE_TYPE_ID BIGINT/i);
  assert.match(baseSql, /ALTER COLUMN LINE_TYPE_ID SET NOT NULL/i);
  assert.match(baseSql, /REFERENCES BUSLANES\.LINE_TYPES \(ID\)/i);
  assert.match(baseSql, /ON DELETE RESTRICT/i);

  assert.match(normalizationSql, /LOWER\(BTRIM\(NAME\)\)/i);
  assert.match(normalizationSql, /CREATE UNIQUE INDEX IF NOT EXISTS LINE_TYPES_NAME_CI_UIDX/i);
  assert.match(normalizationSql, /PROPERTIES - 'lineType'/i);
  assert.match(normalizationSql, /#- '\{_dtpstat,lineType\}'/i);
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

test('admin operation panels cannot shrink under their visible form content', async () => {
  const css = await source('admin/admin.css');

  assert.match(css, /\.task-panel \{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(
    css,
    /\.task-panel > \.operation-panel,[\s\S]*\.task-panel > \.notice \{ flex:\s*0 0 auto; \}/,
  );
  assert.match(
    css,
    /\.operation-panel \{[^}]*min-height:\s*auto;[^}]*overflow:\s*visible;/s,
  );
  assert.doesNotMatch(css, /\.operation-panel \{[^}]*min-height:\s*0;/s);
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

test('admin line type operation uses codes, reloads on opening and exposes style editor', async () => {
  const [html, editor] = await Promise.all([
    source('admin/index.html'),
    source('admin/line-types-editor.js'),
  ]);

  assert.match(html, /src="\/admin\/line-types-editor\.js"/);
  assert.match(html, /href="\/admin\/line-types\.css"/);
  assert.match(html, /id="line-types-editor-host"/);
  assert.match(html, /data-example="kml-sources"/);
  assert.match(editor, /querySelector\('#line-types-editor-host'\)/);
  assert.match(editor, /typeLabel\.textContent = 'code'/);
  assert.match(editor, /data-operation-tab="kml-types"/);
  assert.match(editor, /void load\(\{ changed: true \}\)/);
  assert.match(editor, /input\.type = 'color'/);
  assert.match(editor, /\['solid', 'Сплошная'\]/);
  assert.match(editor, /\['dashed', 'Штриховая'\]/);
  assert.match(editor, /\['dotted', 'Точечная'\]/);
  assert.match(editor, /widthInput\.min = '0\.5'/);
  assert.match(editor, /fetch\('\/api\/admin\/line-types'/);
});

test('public client shows a multi-type legend, toggles layers and refreshes types when returning to the map', async () => {
  const app = await source('public/js/app.js');
  const controller = await source('public/js/map-controller.js');

  assert.match(app, /if \(lineTypes\.length <= 1\) return/);
  assert.match(app, /name\.textContent = lineType\.name/);
  assert.match(app, /setLineTypeVisibility\(lineType\.type, enabled\)/);
  assert.match(app, /window\.addEventListener\('focus'/);
  assert.match(app, /document\.addEventListener\('visibilitychange'/);
  assert.match(app, /await loadLineTypes\(\)/);
  assert.match(app, /applyLineTypes\(lineTypes\)/);
  assert.match(controller, /filter: \['==', \['get', 'lineType'\], lineType\.type\]/);
  assert.match(controller, /map\.setLayoutProperty\(layerId, 'visibility'/);
});
