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

test('line type migrations keep FK storage and migrate to numeric CODE + NAME + TITLE', async () => {
  const [baseSql, normalizationSql, numericSql] = await Promise.all([
    source('db/migrations/V008__line_types.sql'),
    source('db/migrations/V012__line_type_codes_and_unique_names.sql'),
    source('db/migrations/V013__numeric_line_type_codes_and_titles.sql'),
  ]);

  assert.match(baseSql, /CREATE TABLE IF NOT EXISTS BUSLANES\.LINE_TYPES/i);
  assert.match(baseSql, /ADD COLUMN IF NOT EXISTS LINE_TYPE_ID BIGINT/i);
  assert.match(baseSql, /REFERENCES BUSLANES\.LINE_TYPES \(ID\)/i);
  assert.match(normalizationSql, /LOWER\(BTRIM\(NAME\)\)/i);
  assert.match(normalizationSql, /PROPERTIES - 'lineType'/i);

  assert.match(numericSql, /ADD COLUMN IF NOT EXISTS TITLE TEXT/i);
  assert.match(numericSql, /RENAME COLUMN CODE TO LEGACY_CODE/i);
  assert.match(numericSql, /ADD COLUMN CODE INTEGER/i);
  assert.match(numericSql, /SET CODE = 0\s+WHERE LEGACY_CODE = 'default'/i);
  assert.match(numericSql, /LINE_TYPES_CODE_SEQ/i);
  assert.match(numericSql, /LOWER\(BTRIM\(NAME\)\)/i);
  assert.match(numericSql, /Human-readable legend title/i);
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

test('admin line type editor keeps CODE and NAME read-only and edits TITLE/style only', async () => {
  const [html, editor] = await Promise.all([
    source('admin/index.html'),
    source('admin/line-types-editor.js'),
  ]);

  assert.match(html, /src="\/admin\/line-types-editor\.js"/);
  assert.match(html, /href="\/admin\/line-types\.css"/);
  assert.match(html, /id="line-types-editor-host"/);
  assert.match(html, /data-example="kml-sources"/);
  assert.match(editor, /CODE генерируется базой автоматически/);
  assert.match(editor, /NAME приходит из импорта/);
  assert.match(editor, /TITLE — редактируемая подпись легенды/);
  assert.match(editor, /readOnlyField\('CODE', 'code'/);
  assert.match(editor, /readOnlyField\('NAME из импорта', 'name'/);
  assert.match(editor, /titleInput\.name = 'title'/);
  assert.match(editor, /code: Number\(/);
  assert.doesNotMatch(editor, /Добавить тип/);
  assert.match(editor, /data-operation-tab="kml-types"/);
  assert.match(editor, /void load\(\{ changed: true \}\)/);
  assert.match(editor, /colorInput\.type = 'color'/);
  assert.match(editor, /\['solid', 'Сплошная'\]/);
  assert.match(editor, /widthInput\.min = '0\.5'/);
  assert.match(editor, /fetch\('\/api\/admin\/line-types'/);
});

test('public client uses TITLE in legend, hides unused styles, and uses numeric businessTypeCode for layers', async () => {
  const app = await source('public/js/app.js');
  const controller = await source('public/js/map-controller.js');

  assert.match(
    app,
    /const legendLineTypes = lineTypes\.filter\(\(lineType\) => lineType\.geometryCount > 0\)/,
  );
  assert.match(app, /if \(legendLineTypes\.length <= 1\) return/);
  assert.match(app, /for \(const lineType of legendLineTypes\)/);
  assert.match(app, /name\.textContent = lineType\.title \?\? lineType\.name/);
  assert.match(app, /setLineTypeVisibility\(lineType\.code, enabled\)/);
  assert.match(app, /window\.addEventListener\('focus'/);
  assert.match(app, /document\.addEventListener\('visibilitychange'/);
  assert.match(app, /await loadLineTypes\(\)/);
  assert.match(controller, /\['get', 'businessTypeCode'\], lineType\.code/);
  assert.match(controller, /lineLayerIds\.set\(lineType\.code/);
  assert.match(controller, /map\.setLayoutProperty\(layerId, 'visibility'/);
});
