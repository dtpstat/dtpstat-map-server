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
  assert.doesNotMatch(
    html,
    /id="geometry-editor-persist-drafts"/u,
  );
  assert.match(
    html,
    /geometry-editor-storage-mode[\s\S]*localStorage/u,
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
    /change\?\.resource !==[\s\S]*'city-geometries'/u,
  );
  assert.match(
    editor,
    /X-DTPStat-Base-Revision/u,
  );
  assert.match(
    editor,
    /\/api\/admin\/geometry-editor\/sync/u,
  );
  assert.match(
    editor,
    /drafts\.markConflict/u,
  );
  assert.match(
    editor,
    /Операция применена атомарно/u,
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
    /'X-DTPStat-Base-Revision':\s*target\.updatedAt/u,
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
    /geometry-editor-midpoints/u,
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
    /function insertVertexOnSegment/u,
  );
  assert.match(
    editor,
    /map\.on\('click', 'geometry-editor-midpoints'/u,
  );
  assert.doesNotMatch(
    editor,
    /projectedSegmentCoordinate/u,
  );
  assert.doesNotMatch(
    editor,
    /map\.on\('click', 'geometry-editor-segment-hit'/u,
  );
  assert.match(
    editor,
    /deleteVertexAtPath/u,
  );
  assert.doesNotMatch(
    editor,
    /selectedVertexPath|function selectVertex/u,
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
    /topologyTargetReady\(\[[\s\S]*'polygon'[\s\S]*\]\)/u,
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
    /\[\s*'cut',[\s\S]*'split'[\s\S]*\.includes\([\s\S]*drawing\.mode[\s\S]*state\.pendingExternalDraftSync[\s\S]*Topology-операция отменена/u,
  );
});


test('geometry editor keeps existing geometry read-only until explicit edit starts', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /function captureCurrentDraft\(\)[\s\S]*!state\.editing/u,
  );
  assert.match(
    editor,
    /const enabled =[\s\S]*state\.editing/u,
  );
  assert.match(
    editor,
    /function moveVertex[\s\S]*!state\.editing \|\| !state\.draft/u,
  );
  assert.match(
    editor,
    /function insertMidpoint[\s\S]*!state\.editing/u,
  );
  assert.match(
    editor,
    /function deleteVertexAtPath[\s\S]*!state\.editing/u,
  );
  assert.match(
    editor,
    /function undo\(\)[\s\S]*!state\.editing/u,
  );
  assert.match(
    editor,
    /function redo\(\)[\s\S]*!state\.editing/u,
  );
  assert.match(
    editor,
    /function topologyTargetReady\([\s\S]*state\.editing[\s\S]*local\?\.editToken/u,
  );
});


test('geometry begin edit waits for lease and discards stale async acquire results', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /beginEditPendingId: null/u,
  );
  assert.match(
    editor,
    /state\.beginEditPendingId !== null/u,
  );
  assert.match(
    editor,
    /const requestedId = item\.id;[\s\S]*state\.beginEditPendingId =[\s\S]*await api\([\s\S]*\/edit-lock/u,
  );
  assert.match(
    editor,
    /String\(state\.selectedId\)[\s\S]*String\(requestedId\)[\s\S]*releaseDraftLease/u,
  );
  assert.match(
    editor,
    /state\.editing = true;[\s\S]*state\.editLease = lease/u,
  );
  assert.match(
    editor,
    /finally \{[\s\S]*state\.beginEditPendingId =[\s\S]*null;[\s\S]*renderFormState\(\)/u,
  );
});


test('geometry editor exposes foreign lease owner and blocks ordinary begin edit', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /const blockedByOther =[\s\S]*activeLease\.clientId !== realtimeClientId\(\)/u,
  );
  assert.match(
    editor,
    /beginEditButton\.disabled =[\s\S]*blockedByOther/u,
  );
  assert.match(
    editor,
    /const knownLease =[\s\S]*state\.editLeases\.get[\s\S]*knownLease\.clientId !==[\s\S]*realtimeClientId\(\)/u,
  );
  assert.match(
    editor,
    /Эта геометрия уже редактируется пользователем/u,
  );
  assert.match(
    editor,
    /rowLease[\s\S]*редактирует: /u,
  );
  assert.match(
    editor,
    /Geometry edit lease refresh failed/u,
  );
});


test('geometry workspace validates exact persisted tokens and scopes takeover to the revoked geometry', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /validatedEditTokens: new Map\(\)/u,
  );
  assert.match(
    editor,
    /state\.validatedEditTokens\.get\([\s\S]*String\(item\.id\)[\s\S]*=== local\.editToken/u,
  );
  assert.match(
    editor,
    /result\.status === 'valid'[\s\S]*state\.validatedEditTokens\.set/u,
  );
  assert.match(
    editor,
    /invalid\.push\(result\);[\s\S]*drafts\.remove\(result\.id\);[\s\S]*state\.validatedEditTokens\.delete/u,
  );
  assert.match(
    editor,
    /const selectedRevoked =[\s\S]*revokedIds\.has[\s\S]*if \(selectedRevoked\)/u,
  );
  assert.match(
    editor,
    /state\.history = \[\];[\s\S]*state\.future = \[\];[\s\S]*state\.selectedVertexPath = null/u,
  );
  assert.match(
    editor,
    /drafts\.clear\(\);[\s\S]*state\.validatedEditTokens\.clear\(\)/u,
  );
});


test('geometry destructive actions preserve the explicit lease contract', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /Для удаления сначала начните редактирование геометрии/u,
  );
  assert.match(
    editor,
    /method: 'DELETE'[\s\S]*X-DTPStat-Edit-Token/u,
  );
  assert.match(
    editor,
    /\/cut[\s\S]*X-DTPStat-Edit-Token/u,
  );
});


test('geometry workspace keeps new and failed bulk work locally and clears only explicitly', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /const localId =[\s\S]*'local:'[\s\S]*crypto\.randomUUID\(\)/u,
  );
  assert.match(
    editor,
    /kind: 'create'[\s\S]*workspaceKey:[\s\S]*value: payloadFromForm\(\)/u,
  );
  assert.match(
    editor,
    /\/api\/admin\/geometry-editor\/sync[\s\S]*JSON\.stringify\(\{ items \}\)[\s\S]*const updatedIds/u,
  );
  assert.match(
    editor,
    /const createdIds =[\s\S]*payload\.created[\s\S]*drafts\.remove/u,
  );
  assert.match(
    editor,
    /catch \(error\) \{[\s\S]*error\.status === 409[\s\S]*drafts\.markConflict/u,
  );
  assert.match(
    editor,
    /releaseDraftLease[\s\S]*drafts\.clear\(\)/u,
  );
  assert.match(
    editor,
    /state\.workspaceKey = 'unlinked'[\s\S]*rebuildDraftOverlay/u,
  );
  assert.match(
    editor,
    /async function startDrawing\(mode\)[\s\S]*state\.drawing = \{[\s\S]*mode,[\s\S]*coordinates: \[\],[\s\S]*previewCoordinate: null,[\s\S]*\}/u,
  );
  assert.match(
    editor,
    /const showEditable =[\s\S]*state\.editing[\s\S]*backgroundGeometries = showEditable[\s\S]*String\(item\.id\) !==[\s\S]*String\(state\.current\.id\)/u,
  );
});


test('geometry editor filters empty cities and highlights the active geometry on the map', async () => {
  const [
    editor,
    html,
    styles,
  ] =
    await Promise.all([
      read(
        'admin/geometry-editor.js',
      ),
      read(
        'admin/index.html',
      ),
      read(
        'admin/geometry-editor.css',
      ),
    ]);

  assert.match(
    html,
    /id="geometry-editor-city-with-geometries"/u,
  );
  assert.match(
    html,
    /Только города с геометриями/u,
  );
  assert.match(
    editor,
    /cityWithGeometries[\s\S]*\.checked/u,
  );
  assert.match(
    editor,
    /Number\([\s\S]*city\.geometryCount[\s\S]*\) > 0/u,
  );
  assert.match(
    editor,
    /function renderCityOptions/u,
  );
  assert.match(
    editor,
    /const selectedSummary =[\s\S]*state\.selectedId/u,
  );
  assert.match(
    editor,
    /const selectedGeometry =[\s\S]*showEditable[\s\S]*state\.current[\s\S]*selectedSummary/u,
  );
  assert.match(
    editor,
    /getSource\(SELECTED_SOURCE\)[\s\S]*selectedGeometry[\s\S]*featureCollection/u,
  );
  assert.match(
    styles,
    /\.geometry-editor-city-filter/u,
  );
});


test('geometry editor exposes normal unlinked geometry and persistent explicit editing', async () => {
  const [
    editor,
    html,
    styles,
    drafts,
  ] = await Promise.all([
    read('admin/geometry-editor.js'),
    read('admin/index.html'),
    read('admin/geometry-editor.css'),
    read('admin/draft-store.js'),
  ]);

  assert.match(editor, /'__unlinked__'/u);
  assert.match(editor, /\/geometry-editor\/unlinked\/geometries/u);
  assert.match(editor, /drafts\.setPersistent\(true\)/u);
  assert.match(editor, /edit-locks\/validate/u);
  assert.match(editor, /edit-lock\/takeover/u);
  assert.match(editor, /force-takeover/u);
  assert.match(editor, /crypto\.randomUUID\(\)/u);
  assert.match(editor, /30_000/u);
  assert.match(editor, /const showEditable =[\s\S]*state\.editing/u);
  assert.match(editor, /backgroundGeometries = showEditable[\s\S]*filter/u);
  assert.doesNotMatch(
    editor,
    /создавать новые можно только после активации области/u,
  );
  assert.match(html, /id="geometry-begin-edit"/u);
  assert.match(html, /id="geometry-takeover-edit"/u);
  assert.match(html, /Сбросить локальное/u);
  assert.match(styles, /\.geometry-editor-row\.is-unlinked/u);
  assert.match(drafts, /\.\.\.clone\(draft\)/u);
});



test('geometry editor marks leases and exposes coherent map editing modes', async () => {
  const [
    editor,
    styles,
  ] = await Promise.all([
    read('admin/geometry-editor.js'),
    read('admin/geometry-editor.css'),
  ]);

  assert.match(editor, /isEditLocked:[\s\S]*state\.editLeases\.has/u);
  assert.match(editor, /'#737d82'/u);
  assert.match(editor, /ADD_VERTEX_CURSOR/u);
  assert.match(editor, /DELETE_VERTEX_CURSOR/u);
  assert.match(editor, /setText\('Добавить узел'\)/u);
  assert.match(editor, /canvas\.style\.cursor = 'crosshair'/u);
  assert.match(
    editor,
    /geometry-editor-draw-line[\s\S]*'line-color': '#f3b74e'[\s\S]*'line-width': 5/u,
  );
  assert.match(
    editor,
    /geometry-editor-draw-fill[\s\S]*filter: \['==', \['geometry-type'\], 'Polygon'\]/u,
  );
  assert.match(editor, /Добавление точки · кликните по карте/u);
  assert.match(editor, /Добавление линии · точек:/u);
  assert.match(styles, /> span\.is-drawing/u);
});

test('saving locally leaves the lease but exits active edit and can resume it', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /async function saveCurrent\(\)[\s\S]*captureCurrentDraft\(\)[\s\S]*state\.editing = false/u,
  );
  assert.match(
    editor,
    /Активное редактирование завершено, блокировка остаётся за вами/u,
  );
  assert.match(
    editor,
    /const reusableToken =[\s\S]*validatedEditTokens[\s\S]*state\.editing = true/u,
  );
  assert.match(
    editor,
    /Редактирование продолжено с сохранённой блокировкой/u,
  );
  assert.match(
    editor,
    /leasedByThisClient[\s\S]*Локально сохранено · блокировка остаётся за вами/u,
  );
});


test('geometry editor exposes optimistic polygon cutter and line-blade split operations', async () => {
  const [
    page,
    editor,
  ] = await Promise.all([
    read(
      'admin/index.html',
    ),
    read(
      'admin/geometry-editor.js',
    ),
  ]);

  assert.match(
    page,
    /id="geometry-cut-selected"/u,
  );
  assert.match(
    page,
    /Вырезать полигоном/u,
  );
  assert.match(
    page,
    /id="geometry-split"/u,
  );
  assert.match(
    page,
    /Разделить линией/u,
  );

  assert.match(
    editor,
    /cutterGeometryId:[\s\S]*cutter\.id[\s\S]*cutterUpdatedAt:[\s\S]*cutter\.updatedAt/u,
  );
  assert.match(
    editor,
    /\/geometries\/\$\{encodeURIComponent\(target\.id\)\}\/split/u,
  );
  assert.match(
    editor,
    /body:[\s\S]*JSON\.stringify\(\{[\s\S]*blade/u,
  );
  assert.match(
    editor,
    /drawing\.mode === 'split'/u,
  );
  assert.match(
    editor,
    /Разделение режущей линией/u,
  );
  assert.match(
    editor,
    /topologyTargetReady\(\[[\s\S]*'line'[\s\S]*'polygon'/u,
  );
  assert.match(
    editor,
    /releaseDraftLease\([\s\S]*target\.id/u,
  );
});


test('geometry drawing previews the next segment under the pointer and keeps secondary actions compact', async () => {
  const [
    editor,
    page,
    styles,
  ] =
    await Promise.all([
      read(
        'admin/geometry-editor.js',
      ),
      read(
        'admin/index.html',
      ),
      read(
        'admin/geometry-editor.css',
      ),
    ]);

  assert.match(
    editor,
    /previewCoordinate/u,
  );
  assert.match(
    editor,
    /map\.on\('mousemove'[\s\S]*state\.drawing[\s\S]*previewCoordinate[\s\S]*updateDrawingPreview/u,
  );
  assert.match(
    editor,
    /fixed\.length > 0[\s\S]*preview[\s\S]*LineString/u,
  );
  assert.match(
    page,
    /class="geometry-editor-more-actions"[\s\S]*<summary>Ещё<\/summary>/u,
  );
  assert.match(
    page,
    /id="geometry-topology-actions"[\s\S]*<summary>Геометрические операции<\/summary>/u,
  );
  assert.match(
    styles,
    /\.geometry-editor-meta div[\s\S]*grid-template-columns/u,
  );
  assert.match(
    styles,
    /\.geometry-editor-more-menu[\s\S]*position: absolute/u,
  );
});


test('geometry editor exposes coordinate table editing and whole geometry drag as local draft operations', async () => {
  const [
    editor,
    html,
    styles,
    model,
  ] =
    await Promise.all([
      read(
        'admin/geometry-editor.js',
      ),
      read(
        'admin/index.html',
      ),
      read(
        'admin/geometry-editor.css',
      ),
      read(
        'admin/geometry-coordinate-model.js',
      ),
    ]);

  for (const id of [
    'geometry-coordinate-open',
    'geometry-coordinate-window',
    'geometry-coordinate-sequence',
    'geometry-coordinate-table-body',
    'geometry-coordinate-paste',
    'geometry-coordinate-import',
    'geometry-coordinate-apply',
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
    /from '\.\/geometry-coordinate-model\.js'/u,
  );
  assert.match(
    editor,
    /function openCoordinateWindow\(\)/u,
  );
  assert.match(
    editor,
    /parseCoordinateText\([\s\S]*coordinatePaste\.value/u,
  );
  assert.match(
    editor,
    /replaceCoordinateSequence\([\s\S]*state\.draft[\s\S]*descriptor\.path/u,
  );
  assert.match(
    editor,
    /pushHistory\(\);[\s\S]*state\.draft = next;[\s\S]*captureCurrentDraft\(\)/u,
  );

  assert.doesNotMatch(
    html,
    /id="geometry-move-toggle"/u,
  );
  assert.doesNotMatch(
    editor,
    /moveGeometryMode|setMoveGeometryMode|moveGeometryButton|selectedDragLayers/u,
  );
  assert.match(
    editor,
    /geometryDrag: null/u,
  );
  assert.match(
    editor,
    /'mousedown',[\s\S]*'geometry-editor-segment-hit',[\s\S]*beginGeometryDrag/u,
  );
  assert.match(
    editor,
    /screenOrigin[\s\S]*Math\.hypot[\s\S]*pixelDistance < 3/u,
  );
  assert.match(
    editor,
    /translateGeometry\([\s\S]*state\.geometryDrag[\s\S]*original[\s\S]*dx,[\s\S]*dy/u,
  );
  assert.match(
    editor,
    /state\.pendingExternalDraftSync[\s\S]*state\.geometryDrag[\s\S]*state\.coordinateWindowOpen/u,
  );
  assert.match(
    editor,
    /state\.geometryDrag[\s\S]*pushHistory\(\)[\s\S]*map\.dragPan\.disable/u,
  );

  assert.match(
    model,
    /export function parseCoordinateText/u,
  );
  assert.match(
    model,
    /export function coordinateSequences/u,
  );
  assert.match(
    model,
    /export function replaceCoordinateSequence/u,
  );
  assert.match(
    model,
    /export function translateGeometry/u,
  );

  assert.match(
    styles,
    /\.geometry-coordinate-window\s*\{[\s\S]*position: fixed/u,
  );
  assert.doesNotMatch(
    styles,
    /#geometry-move-toggle/u,
  );
});
