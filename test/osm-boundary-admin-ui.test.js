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
  const [html, shell, editor, styles, publicApp, derivedEvents] = await Promise.all([
    read('admin/index.html'),
    read('admin/admin-shell.js'),
    read('admin/osm-boundary-editor.js'),
    read('admin/osm-boundary-editor.css'),
    read('public/js/app.js'),
    read('admin/derived-data-events.js'),
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
  assert.match(html, /class="osm-boundary-state-legend"/);
  assert.match(html, /is-active[\s\S]*включена/);
  assert.match(html, /is-partial[\s\S]*частично/);
  assert.match(html, /is-inactive[\s\S]*выключена/);
  assert.match(
    html,
    /name="population"[^>]*type="number"[^>]*max="2147483647"/,
  );
  assert.match(html, /name="populationAsOf"[^>]*type="date"/);
  assert.match(
    html,
    /name="populationSource"[^>]*type="text"[^>]*maxlength="500"/,
  );
  assert.match(html, /textarea name="attributes"[^>]*disabled/);
  assert.match(
    html,
    /name="population"[\s\S]*<button type="submit" disabled>Сохранить объект<\/button>[\s\S]*id="osm-boundary-enable-branch"[\s\S]*id="osm-boundary-disable-branch"[\s\S]*id="osm-boundary-meta"/,
  );
  assert.match(html, /Включить ветку/);
  assert.match(html, /Отключить ветку/);
  assert.doesNotMatch(html, /data-operation-tab="osm-objects"/);
  assert.doesNotMatch(html, /data-operation-panel="osm-objects"/);

  assert.match(shell, /'osm-objects':[\s\S]*canEditOsm/);
  assert.match(shell, /if \(canEditOsm\(user\)\) await import\('\.\/osm-boundary-editor\.js'\)/);
  assert.doesNotMatch(shell, /async function loadDataEditors\(\)[\s\S]*osm-boundary-editor\.js[\s\S]*setupDataSectionLockExtensions/);
  assert.match(shell, /dtpstat:osm-boundary-editor-open/);
  assert.match(editor, /#admin-section-osm-objects/);
  assert.match(editor, /population\.dataset\.initialValue/);
  assert.match(editor, /changes\.population/);
  assert.match(editor, /const populationAsOf = field\('populationAsOf'\)/);
  assert.match(editor, /const populationSource = field\('populationSource'\)/);
  assert.match(editor, /const attributes = field\('attributes'\)/);
  assert.match(
    editor,
    /active,[\s\S]*displayName,[\s\S]*displayType,[\s\S]*population,[\s\S]*populationAsOf,[\s\S]*populationSource,[\s\S]*attributes,[\s\S]*save/,
  );
  assert.doesNotMatch(
    editor,
    /population\.disabled\s*=\s*!active\.checked/,
  );
  assert.doesNotMatch(editor, /population\.addEventListener\('input'/);
  assert.doesNotMatch(
    editor,
    /(?:population|populationAsOf|populationSource|attributes)[\s\S]{0,300}active\.checked\s*=\s*true/,
  );
  assert.match(editor, /changes\.populationAsOf/);
  assert.match(editor, /changes\.populationSource/);
  assert.match(editor, /changes\.attributes/);
  assert.match(
    html,
    /Данные территории хранятся независимо от флага «Активен»/,
  );
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
  assert.match(editor, /function subtreeItems\(rootId\)/);
  assert.match(editor, /expandedIds:\s*new Set\(\)/);
  assert.match(editor, /aggregateBoundaryBranchStatus/);
  assert.match(editor, /is-\$\{aggregate\.status\}/);
  assert.match(editor, /searchMode \|\| state\.expandedIds\.has\(item\.id\)/);
  assert.match(editor, /toggle\.disabled = searchMode/);
  assert.match(editor, /aria-expanded/);
  assert.match(editor, /function updateBranchActions\(item\)/);
  assert.match(editor, /async function setBranchActive\(nextActive\)/);
  assert.match(
    editor,
    /\/api\/admin\/osm-boundaries\/\$\{encodeURIComponent\(item\.id\)\}\/subtree/,
  );
  assert.match(editor, /window\.confirm\(/);
  assert.match(editor, /publishDerivedDataChange\('osm-boundary'\)/);
  assert.match(editor, /publishDerivedDataChange\('osm-boundary-subtree'\)/);
  assert.match(
    editor,
    /await api\([\s\S]*publishDerivedDataChange\('osm-boundary'\)/,
  );
  assert.match(derivedEvents, /new BroadcastChannel\(CHANNEL_NAME\)/);
  assert.match(derivedEvents, /window\.localStorage\.setItem\(STORAGE_KEY/);
  assert.match(publicApp, /subscribeDerivedDataChanges\(/);
  assert.match(publicApp, /async function refreshDerivedData\(\)/);
  assert.match(
    publicApp,
    /Promise\.all\(\[[\s\S]*loadCities\(\)[\s\S]*loadLineTypes\(\)/,
  );
  assert.match(publicApp, /mapController\.setCities\(cities\)/);
  assert.match(publicApp, /mapController\.refreshViewport\(\)/);
  assert.match(editor, /enableBranch\?\.addEventListener\('click'/);
  assert.match(editor, /disableBranch\?\.addEventListener\('click'/);
  assert.match(html, /\/vendor\/mapbox-gl\/mapbox-gl\.css/);
  assert.match(html, /\/vendor\/mapbox-gl\/mapbox-gl\.js/);
  assert.doesNotMatch(html, /leaflet/i);
  assert.match(editor, /api\('\/api\/config'\)/);
  assert.match(editor, /new globalThis\.mapboxgl\.Map/);
  assert.match(editor, /state\.map\.addSource\(MAP_SOURCE_ID/);
  assert.match(editor, /type: 'fill'/);
  assert.match(editor, /type: 'line'/);
  assert.match(editor, /map\.getSource\(MAP_SOURCE_ID\)\.setData\(feature\)/);
  assert.match(editor, /map\.fitBounds\(bounds/);
  assert.match(editor, /map\.resize\(\)/);
  assert.doesNotMatch(editor, /globalThis\.L|tile\.openstreetmap\.org|Leaflet/);
  assert.match(
    styles,
    /grid-template-columns:\s*minmax\(19rem, \.72fr\)[\s\S]*minmax\(30rem, 1\.8fr\)[\s\S]*minmax\(20rem, \.82fr\)/,
  );
  assert.match(styles, /#osm-boundary-form[\s\S]*flex-direction:\s*column/);
  assert.match(styles, /\.osm-boundary-tree-panel[\s\S]*flex-direction:\s*column/);
  assert.match(styles, /\.osm-boundary-tree[\s\S]*overflow:\s*auto/);
  assert.match(
    styles,
    /\.osm-boundary-branch-actions[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(styles, /\.osm-boundary-state-legend/);
  assert.match(styles, /\.osm-boundary-node-row/);
  assert.match(styles, /\.osm-boundary-toggle/);
  assert.match(styles, /\.osm-boundary-active-dot\.is-active/);
  assert.match(styles, /\.osm-boundary-active-dot\.is-inactive/);
  assert.match(styles, /\.osm-boundary-active-dot\.is-partial/);
  assert.match(styles, /\.mapboxgl-ctrl-attrib/);
  assert.doesNotMatch(styles, /leaflet/i);
});


test('OSM update UI exposes explicit resume restart and discard controls', async () => {
  const [html, admin, styles] = await Promise.all([
    read('admin/index.html'),
    read('admin/admin.js'),
    read('admin/admin.css'),
  ]);

  assert.match(html, /id="osm-checkpoint"[^>]*hidden/);
  assert.match(html, /id="osm-checkpoint-summary"/);
  assert.match(html, /id="osm-resume"/);
  assert.match(html, /Возобновить/);
  assert.match(html, /id="osm-checkpoint-discard"/);
  assert.match(html, /Удалить сохранённый прогресс/);

  assert.match(admin, /osmCheckpoint:\s*null/);
  assert.match(admin, /async function loadOsmCheckpoint\(\)/);
  assert.match(admin, /\/api\/admin\/osm-checkpoint/);
  assert.match(admin, /resume:\s*'true'/);
  assert.match(admin, /restart:\s*String\(restart\)/);
  assert.match(admin, /Запустить OSM заново/);
  assert.match(admin, /window\.confirm\([\s\S]*сохранённый прогресс OSM/i);
  assert.match(admin, /method:\s*'DELETE'/);

  assert.match(styles, /\.osm-checkpoint\s*\{/);
  assert.match(styles, /\.osm-checkpoint-actions/);
});


test('admin task UI distinguishes partial import success', async () => {
  const [admin, styles] = await Promise.all([
    read('admin/admin.js'),
    read('admin/admin.css'),
  ]);

  assert.match(admin, /phase === 'warnings'/);
  assert.match(admin, /Есть предупреждения/);
  assert.match(admin, /task\.result\?\.partial/);
  assert.match(admin, /result-warning/);
  assert.match(admin, /status-partial/);
  assert.match(admin, /операция завершена с предупреждениями/);
  assert.match(styles, /\.status-partial\s*\{[^}]*var\(--warning\)/);
  assert.match(styles, /\.result-warning\s*\{/);
  assert.match(styles, /\.result-warning summary\s*\{[^}]*var\(--warning\)/);
});


test('admin clears previous task status immediately when a new operation starts', async () => {
  const [admin, notices, security] = await Promise.all([
    read('admin/admin.js'),
    read('admin/task-notices.js'),
    read('admin/security-editor-v2.js'),
  ]);

  assert.match(admin, /function clearTaskStatusForStart\(/);
  assert.match(
    admin,
    /clearTaskStatusForStart\(taskKey\);[\s\S]*showTransferOverlay/,
  );
  assert.match(
    admin,
    /async function start\([\s\S]*clearTaskStatusForStart\(taskKey\)/,
  );
  assert.match(admin, /taskNotices\.clear\(taskKey\)/);
  assert.match(notices, /clear\(taskKey\)/);
  assert.match(security, /entry\.details\?\.taskLog/);
  assert.match(security, /Журнал \(\$\{taskLogCount\}\)/);
  assert.match(admin, /phase === 'stage-write'/);
  assert.match(admin, /Ожидаем PostgreSQL\/PostGIS/);
  assert.match(admin, /phase === 'delete-boundaries'/);
  assert.match(admin, /Удаление старых территорий/);
  assert.match(admin, /phase === 'insert-boundaries'/);
  assert.match(admin, /Вставка новых территорий/);
  assert.match(admin, /phase === 'hierarchy'/);
  assert.match(admin, /Построение иерархии территорий/);
  assert.match(admin, /function stableProcessingView\(/);
  assert.match(admin, /Чтение и подготовка входного JSON/);
  assert.match(admin, /PostgreSQL\/PostGIS:/);
  assert.match(admin, /processingStatus\.hidden = !progress\.stableInputProgress/);
  assert.match(admin, /for \(const entry of parseEntries\)/);
  assert.match(admin, /decodedBytes = Math\.max\(/);
  assert.match(admin, /itemCount = Math\.max\(/);
  assert.match(admin, /function syncSessionActivityHold\(/);
  assert.match(admin, /dtpstatAdminSessionGuard\?\.setActivityHold/);
  assert.match(
    admin,
    /Boolean\(state\.transfer\) \|\| Boolean\(active\(state\.task\)\)/,
  );
});
