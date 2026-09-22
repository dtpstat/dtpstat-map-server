import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFile(path.join(root, relative), 'utf8');

test('universal geometry snapshot exports every supported geometry without active-boundary dependency', async () => {
  const source = await read('src/db/data-export-repository.js');
  assert.match(source, /dtpstat-project-geometries/);
  assert.match(source, /schemaVersion', 4/);
  assert.match(source, /'displayName', geometry\.display_name/);
  assert.match(source, /'tooltip', geometry\.tooltip/);
  assert.match(source, /'tags', geometry\.tags/);
  assert.match(source, /'sourceTags', geometry\.source_tags/);
  assert.match(source, /'isVisible', geometry\.is_visible/);
  assert.match(source, /'wasEdited', geometry\.was_edited/);
  assert.match(source, /LEFT JOIN city_boundaries AS boundary ON boundary\.id = geometry\.boundary_id/);
  assert.match(source, /LEFT JOIN line_types AS line_type ON line_type\.id = geometry\.line_type_id/);
  assert.match(source, /STREAM_GEOMETRIES_SQL/);
  assert.match(source, /streamGeometries/);
  assert.match(source, /exportGeometries/);
});

test('legacy line export is explicitly line-only but no longer drops lines with inactive or missing boundary', async () => {
  const source = await read('src/db/data-export-repository.js');
  const start = source.indexOf('const EXPORT_LINES_SQL');
  const end = source.indexOf('const EXPORT_GEOMETRIES_SQL');
  const legacy = source.slice(start, end);
  assert.match(legacy, /GeometryType\(geometry\.geom\) IN \('LINESTRING', 'MULTILINESTRING'\)/);
  assert.match(legacy, /LEFT JOIN city_boundaries AS boundary/);
  assert.doesNotMatch(legacy, /boundary\.is_active/);
});

test('geometry editor exposes the universal snapshot endpoints', async () => {
  const [api, html] = await Promise.all([
    read('src/routes/api.js'),
    read('admin/index.html'),
  ]);
  assert.match(api, /\/admin\/export\/geometries/);
  assert.match(api, /requireGeometryEditor/);
  assert.match(html, /\/api\/admin\/export\/geometries/);
  assert.match(html, /ZIP snapshot/);
});
