import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );

const read =
  (relativePath) =>
    fs.readFile(
      path.join(
        root,
        relativePath,
      ),
      'utf8',
    );

test('geometry editor is a dedicated permission-protected top-level admin section', async () => {
  const [
    html,
    shell,
    styles,
  ] =
    await Promise.all([
      read('admin/index.html'),
      read('admin/admin-shell.js'),
      read('admin/geometry-editor.css'),
    ]);

  assert.match(
    html,
    /data-admin-section-tab="geometries"[\s\S]*aria-controls="admin-section-geometries"/u,
  );
  assert.match(
    html,
    /id="admin-section-geometries"[\s\S]*id="geometry-editor-list"[\s\S]*id="geometry-editor-map"[\s\S]*id="geometry-editor-form"/u,
  );
  assert.match(
    html,
    /id="geometry-editor-draft-count"/u,
  );
  assert.match(
    html,
    /id="geometry-editor-persist-drafts"/u,
  );
  assert.match(
    html,
    /id="geometry-editor-save-all"/u,
  );
  assert.match(
    html,
    /id="geometry-editor-discard-all"/u,
  );

  assert.match(
    shell,
    /function canEditGeometries\(user\)/u,
  );
  assert.match(
    shell,
    /geometries: !mustChangePassword && canEditGeometries\(user\)/u,
  );
  assert.match(
    shell,
    /if \(canEditGeometries\(user\)\) await import\('\.\/geometry-editor\.js'\)/u,
  );
  assert.match(
    shell,
    /dtpstat:geometry-editor-open/u,
  );

  assert.match(
    styles,
    /grid-template-columns:\s*minmax\(19rem, \.72fr\)[\s\S]*minmax\(30rem, 1\.8fr\)[\s\S]*minmax\(20rem, \.82fr\)/u,
  );
  assert.match(
    styles,
    /\.geometry-editor-row\.has-conflict/u,
  );
});

test('geometry editor uses local drafts optimistic revisions atomic bulk save and realtime sync', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /createDraftStore/u,
  );
  assert.match(
    editor,
    /namespace: 'city-geometries'/u,
  );
  assert.match(
    editor,
    /realtimeMutationHeaders/u,
  );
  assert.match(
    editor,
    /subscribeAdminRealtime/u,
  );
  assert.match(
    editor,
    /resource !== 'city-geometries'/u,
  );
  assert.match(
    editor,
    /X-DTPStat-Base-Revision/u,
  );
  assert.match(
    editor,
    /\/api\/admin\/geometry-editor\/geometries', \{\s*method: 'PATCH'/u,
  );
  assert.match(
    editor,
    /drafts\.markConflict/u,
  );
  assert.match(
    editor,
    /Все локальные черновики применены атомарно/u,
  );

  assert.match(
    editor,
    /geometry-import\/pending/u,
  );
  assert.match(
    editor,
    /'\/api\/admin\/geometry-editor\/merge'/u,
  );
  assert.match(
    editor,
    /baseUpdatedAt:\s*item\.updatedAt/u,
  );
  assert.match(
    editor,
    /startDrawing\('cut'\)/u,
  );
  assert.match(
    editor,
    /\/geometry-editor\/geometries\/\$\{encodeURIComponent\(target\.id\)\}\/cut/u,
  );
  assert.match(
    editor,
    /'X-DTPStat-Base-Revision': target\.updatedAt/u,
  );
});

test('geometry editor keeps direct vertex editing and progressive loading', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /function editableSequences\(geometry\)/u,
  );
  assert.match(
    editor,
    /kind: 'midpoint'/u,
  );
  assert.match(
    editor,
    /kind: 'segment'/u,
  );
  assert.match(
    editor,
    /geometry-editor-segment-hit/u,
  );
  assert.match(
    editor,
    /'line-width': 18/u,
  );
  assert.match(
    editor,
    /map\.on\('mousedown', 'geometry-editor-vertices'/u,
  );
  assert.match(
    editor,
    /insertMidpoint/u,
  );
  assert.match(
    editor,
    /deleteVertexAtPath/u,
  );
  assert.match(
    editor,
    /state\.history\.length > 50/u,
  );
  assert.match(
    editor,
    /\/geometry-editor\/cities\/\$\{encodeURIComponent\(cityId\)\}\/geometries/u,
  );
  assert.match(
    editor,
    /\/geometry-editor\/geometries\/\$\{encodeURIComponent\(id\)\}/u,
  );
});


test('geometry merge and cut stay revision-safe around local drafts', async () => {
  const [
    editor,
    html,
    styles,
  ] =
    await Promise.all([
      read('admin/geometry-editor.js'),
      read('admin/index.html'),
      read('admin/geometry-editor.css'),
    ]);

  assert.match(
    html,
    /id="geometry-merge-selected" type="button"\s+disabled/u,
  );
  assert.doesNotMatch(
    html,
    /id="geometry-merge-selected"[^>]*hidden/u,
  );
  assert.match(
    html,
    /id="geometry-cut-area"/u,
  );

  assert.match(
    editor,
    /check\.disabled = Boolean\([\s\S]*state\.importSession[\s\S]*item\._draft[\s\S]*item\._conflict[\s\S]*\);/u,
  );
  assert.match(
    editor,
    /function mergeProblem\(items\)/u,
  );
  assert.match(
    editor,
    /Сначала сохраните или сбросьте локальные черновики выбранных геометрий/u,
  );
  assert.match(
    editor,
    /sourceGeometryIds/u,
  );
  assert.match(
    editor,
    /familyOf\(state\.draft\) !== 'polygon'/u,
  );
  assert.match(
    editor,
    /const local = captureCurrentDraft\(\)/u,
  );

  assert.match(
    styles,
    /\.geometry-editor-row-select/u,
  );
  assert.match(
    styles,
    /\.geometry-editor-row-main/u,
  );
});


test('geometry editor resolves staged import conflicts visually without dropping local drafts', async () => {
  const [
    editor,
    html,
    styles,
  ] =
    await Promise.all([
      read('admin/geometry-editor.js'),
      read('admin/index.html'),
      read('admin/geometry-editor.css'),
    ]);

  for (const id of [
    'geometry-import-conflicts',
    'geometry-import-conflict-list',
    'geometry-import-apply',
    'geometry-import-discard',
    'geometry-conflict-decision',
    'geometry-conflict-candidates',
    'geometry-conflict-keep',
    'geometry-conflict-add',
    'geometry-conflict-replace',
  ]) {
    assert.match(
      html,
      new RegExp(
        `id="${id}"`,
        'u',
      ),
    );
  }

  assert.match(
    editor,
    /const IMPORT_SOURCE = 'geometry-editor-import-conflict'/u,
  );
  assert.match(
    editor,
    /geometry-editor-import-incoming/u,
  );
  assert.match(
    editor,
    /geometry-editor-import-existing/u,
  );
  assert.match(
    editor,
    /function renderImportConflicts\(\)/u,
  );
  assert.match(
    editor,
    /function setConflictDecision/u,
  );
  assert.match(
    editor,
    /'keep-existing'/u,
  );
  assert.match(
    editor,
    /'add-new'/u,
  );
  assert.match(
    editor,
    /'replace'/u,
  );
  assert.match(
    editor,
    /conflictAdd\.disabled =\s*Boolean/u,
  );
  assert.match(
    editor,
    /draftFor\(\s*candidate\.existing\.id/u,
  );
  assert.match(
    editor,
    /captureCurrentDraft\(\)/u,
  );
  assert.match(
    editor,
    /waitForGeometryImportTask/u,
  );
  assert.match(
    editor,
    /geometry-import\/tasks\//u,
  );
  assert.match(
    styles,
    /\.geometry-import-conflicts/u,
  );
  assert.match(
    styles,
    /\.geometry-conflict-candidate\.has-local-draft/u,
  );
});


test('geometry persistent drafts synchronize across tabs and coalesce storage with realtime refresh', async () => {
  const [
    drafts,
    geometry,
    osm,
  ] =
    await Promise.all([
      read(
        'admin/draft-store.js',
      ),
      read(
        'admin/geometry-editor.js',
      ),
      read(
        'admin/osm-boundary-editor.js',
      ),
    ]);

  assert.match(
    drafts,
    /subscribe\(listener\)/u,
  );
  assert.match(
    drafts,
    /addEventListener\(\s*'storage'/u,
  );
  assert.match(
    drafts,
    /changedIds/u,
  );
  assert.match(
    drafts,
    /removedIds/u,
  );
  assert.match(
    drafts,
    /if \(\s*Boolean\(\s*drafts\[key\][\s\S]*\.conflict[\s\S]*=== nextConflict/u,
  );

  assert.match(
    geometry,
    /drafts\.subscribe/u,
  );
  assert.match(
    geometry,
    /handleExternalDraftChange/u,
  );
  assert.match(
    geometry,
    /pendingExternalDraftSync/u,
  );
  assert.match(
    geometry,
    /scheduleGeometryServerSync\(\s*'realtime'/u,
  );
  assert.doesNotMatch(
    geometry,
    /void refresh\(\{ keepSelection: true, fit: false \}\)\.then/u,
  );

  assert.match(
    osm,
    /drafts\.subscribe/u,
  );
  assert.match(
    osm,
    /scheduleOsmServerSync\(\s*'realtime'/u,
  );
});


test('geometry editor does not overwrite a cross-tab draft after an in-progress drag or cut', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /if \(\s*state\.pendingExternalDraftSync\s*\) \{\s*flushPendingExternalDraftSync\(\);\s*\} else \{\s*captureCurrentDraft\(\);/u,
  );
  assert.match(
    editor,
    /drawing\.mode === 'cut'[\s\S]*state\.pendingExternalDraftSync[\s\S]*Вырезание отменено/u,
  );
});
