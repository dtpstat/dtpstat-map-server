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
    /geometries: !restricted && canEditGeometries\(user\)/u,
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
    /'\/api\/admin\/geometry-editor\/topology\/union-preview'/u,
  );
  assert.match(
    editor,
    /baseUpdatedAt:\s*item\.updatedAt/u,
  );
  assert.match(
    editor,
    /startDrawing\(\s*'cut',?\s*\)/u,
  );
  assert.match(
    editor,
    /\/geometry-editor\/topology\/cut-preview/u,
  );
  assert.match(
    editor,
    /sourceGeometry:[\s\S]*state\.draft[\s\S]*cutterGeometry/u,
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


test('geometry union and cut operate on effective local geometry while persistence stays in sync', async () => {
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
  assert.match(
    html,
    /id="geometry-cut-area"/u,
  );
  assert.match(
    editor,
    /check\.disabled = Boolean\([\s\S]*state\.importSession[\s\S]*item\._conflict[\s\S]*\);/u,
  );
  assert.doesNotMatch(
    editor,
    /check\.disabled = Boolean\([\s\S]{0,180}item\._local/u,
  );
  assert.match(
    editor,
    /topology\/union-preview/u,
  );
  assert.match(
    editor,
    /geometries:[\s\S]*items\.map[\s\S]*item\.geometry/u,
  );
  assert.match(
    editor,
    /kind:[\s\S]*'delete'[\s\S]*topologyKind:[\s\S]*'union'/u,
  );
  assert.match(
    editor,
    /topologyOriginalEntries/u,
  );
  assert.match(
    editor,
    /originalEntries\.length[\s\S]*drafts\.upsert/u,
  );
  assert.match(
    editor,
    /entry\.kind === 'delete'[\s\S]*baseUpdatedAt[\s\S]*editToken/u,
  );
  assert.match(
    editor,
    /cutter\.family !== 'polygon'[\s\S]*!cutter\.geometry[\s\S]*cutter\._conflict/u,
  );
  assert.doesNotMatch(
    editor,
    /cutter\._draft|!cutter\.updatedAt/u,
  );
  assert.match(
    styles,
    /\.geometry-editor-row-select/u,
  );
});


test('undoing a topology group releases every server lease in the group', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  const start =
    editor.indexOf(
      'async function undoTopologyGroup',
    );
  const end =
    editor.indexOf(
      'async function topologyFailure',
      start,
    );
  const source =
    editor.slice(
      start,
      end,
    );

  assert.match(
    source,
    /group[\s\S]*\.filter\([\s\S]*editToken[\s\S]*\.map\([\s\S]*releaseDraftLease/u,
  );
  assert.doesNotMatch(
    source,
    /root\?\.editToken[\s\S]*releaseDraftLease/u,
  );
});


test('geometry list highlights manually edited geometries and hides bulk checkboxes until requested', async () => {
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
    /function effectiveSummary\(item\)[\s\S]*\.\.\.effective[\s\S]*family:/u,
  );
  assert.match(
    editor,
    /row\.classList\.toggle\([\s\S]*'is-edited'[\s\S]*item\.wasEdited/u,
  );
  assert.match(
    editor,
    /isEdited:[\s\S]*item\._local[\s\S]*item\._draft[\s\S]*item\.wasEdited/u,
  );
  assert.match(
    editor,
    /state\.bulkSelecting[\s\S]*row\.append\([\s\S]*check[\s\S]*open/u,
  );
  assert.match(
    page,
    /id="geometry-bulk-select"[\s\S]*Выбрать несколько/u,
  );
  assert.match(
    page,
    /id="geometry-merge-selected"[\s\S]*hidden/u,
  );
  assert.match(
    styles,
    /\.geometry-editor-row\.is-edited[\s\S]*inset 3px 0/u,
  );
  assert.match(
    styles,
    /\.geometry-editor-row\.is-bulk-selecting[\s\S]*auto minmax/u,
  );
});


test('selected polygon exposes a direct local cutout action without forced server sync', async () => {
  const [
    editor,
    page,
  ] =
    await Promise.all([
      read(
        'admin/geometry-editor.js',
      ),
      read(
        'admin/index.html',
      ),
    ]);

  assert.match(
    page,
    /id="geometry-cut-direct"[\s\S]*Вырезать отверстие/u,
  );
  assert.match(
    editor,
    /async function startPolygonCut\(\)[\s\S]*if \(!state\.editing\)[\s\S]*await beginEditing\(\)[\s\S]*startDrawing\([\s\S]*'cut'/u,
  );
  assert.doesNotMatch(
    editor,
    /Сохранить полигон перед вырезанием/u,
  );
  assert.match(
    editor,
    /topology\/cut-preview/u,
  );
});


test('cut preview on a new local polygon keeps an original snapshot for revert', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /async function cutTarget\([\s\S]*localTarget[\s\S]*existing\?\.kind ===[\s\S]*'create'[\s\S]*topologyOriginalValue:[\s\S]*existing\.value/u,
  );
  assert.match(
    editor,
    /topologyKind:[\s\S]*'cut'[\s\S]*topologyGroupId/u,
  );
});


test('topology menu closes as soon as cut or split mode is selected', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /cutButton\.addEventListener[\s\S]*topologyActions\.open =[\s\S]*false[\s\S]*startPolygonCut/u,
  );
  assert.match(
    editor,
    /splitButton\.addEventListener[\s\S]*topologyActions\.open =[\s\S]*false[\s\S]*startDrawing\([\s\S]*'split'/u,
  );
});


test('drawn topology operations accept local targets without a server revision', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );
  const start =
    editor.indexOf(
      'async function finishDrawing()',
    );
  const end =
    editor.indexOf(
      'function payloadFromForm()',
      start,
    );
  const source =
    editor.slice(
      start,
      end,
    );

  assert.doesNotMatch(
    source,
    /!target\.updatedAt/u,
  );
  assert.match(
    source,
    /await splitTarget/u,
  );
  assert.match(
    source,
    /await cutTarget/u,
  );
});


test('split preview stages one source draft and every returned companion until atomic sync', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /topology\/split-preview/u,
  );
  assert.match(
    editor,
    /topologyGroupId/u,
  );
  assert.match(
    editor,
    /const companionIds =[\s\S]*parts[\s\S]*\.slice\(1\)[\s\S]*crypto\.randomUUID/u,
  );
  assert.match(
    editor,
    /for \([\s\S]*companionIds[\s\S]*\.entries\(\)[\s\S]*drafts\.upsert/u,
  );
  assert.match(
    editor,
    /topologyLocalIds/u,
  );
  assert.match(
    editor,
    /sourceGeometryId:[\s\S]*Number\([\s\S]*target\.id/u,
  );
  assert.match(
    editor,
    /expandDraftEntries\([\s\S]*topologyGroupId/u,
  );
  assert.match(
    editor,
    /entry\.sourceGeometryId[\s\S]*sourceGeometryId/u,
  );
  assert.match(
    editor,
    /undoTopologyGroup/u,
  );
  assert.match(
    editor,
    /атомарно запишет все части/u,
  );
});


test('saved local server draft remains revertible outside active edit mode', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /revertButton\.disabled =[\s\S]*!localDraft[\s\S]*state\.drawing/u,
  );
  assert.doesNotMatch(
    editor,
    /revertButton\.disabled =[\s\S]{0,120}!enabled/u,
  );
});


test('local split topology drafts expose revert and restore the original local geometry', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /const localTopologyDraft =[\s\S]*localDraft[\s\S]*topologyGroupId/u,
  );
  assert.match(
    editor,
    /revertButton\.hidden =[\s\S]*localItem[\s\S]*!localTopologyDraft/u,
  );
  assert.match(
    editor,
    /local\?\.topologyGroupId[\s\S]*undoTopologyGroup\([\s\S]*Исходная локальная геометрия восстановлена/u,
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
    /function insertVertexOnSegment[\s\S]*!state\.editing/u,
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
    /function topologyTargetReady\([\s\S]*state\.editing[\s\S]*localItem[\s\S]*local\?\.editToken/u,
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
    /const draftTokenIsValid =[\s\S]*state\.validatedEditTokens\.get\([\s\S]*String\(state\.selectedId\)[\s\S]*=== currentDraft\.editToken[\s\S]*state\.editing =[\s\S]*state\.editing &&[\s\S]*draftTokenIsValid/u,
  );
  assert.match(
    editor,
    /function adoptGeometryDetail[\s\S]*state\.editing = false;[\s\S]*state\.editLease = null;/u,
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
    /if \(selectedRevoked\)[\s\S]*state\.editing = false;[\s\S]*state\.editLease = null;[\s\S]*state\.blockedLease = null;[\s\S]*state\.history = \[\];[\s\S]*state\.future = \[\];/u,
  );
  assert.match(
    editor,
    /drafts\.clear\(\);[\s\S]*state\.validatedEditTokens\.clear\(\)/u,
  );
});


test('geometry destructive actions keep one delete action with server confirmation and lease safety', async () => {
  const [
    editor,
    page,
  ] =
    await Promise.all([
      read(
        'admin/geometry-editor.js',
      ),
      read(
        'admin/index.html',
      ),
    ]);

  assert.match(
    page,
    /id="geometry-delete"[\s\S]*>\s*Удалить\s*<\/button>/u,
  );
  assert.match(
    editor,
    /deleteButton\.disabled =[\s\S]*!item\?\.id[\s\S]*state\.beginEditPendingId !== null/u,
  );
  assert.match(
    editor,
    /deleteButton\.addEventListener\('click'[\s\S]*isLocalGeometryId\([\s\S]*drafts\.remove\([\s\S]*Геометрия удалена\./u,
  );
  assert.match(
    editor,
    /Вы уверены, что хотите удалить геометрию с сервера\?/u,
  );
  assert.match(
    editor,
    /if \(!state\.editing\)[\s\S]*await beginEditing\(\)[\s\S]*method: 'DELETE'[\s\S]*X-DTPStat-Edit-Token/u,
  );
  assert.match(
    editor,
    /revertButton\.hidden =[\s\S]*localItem/u,
  );
  assert.match(
    editor,
    /\/topology\/cut-preview/u,
  );
  assert.doesNotMatch(
    editor,
    /topology\/cut-preview[\s\S]{0,500}X-DTPStat-Edit-Token/u,
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



test('locally changing a line type immediately drives the selected map style', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /const selectedGeometry =[\s\S]*\.\.\.\(selectedSummary \?\? state\.current \?\? \{\}\)/u,
  );
  assert.match(
    editor,
    /geometry-editor-selected-line-halo[\s\S]*lineWidth[\s\S]*\+?[\s\S]*4/u,
  );
  assert.match(
    editor,
    /id: 'geometry-editor-selected-line'[\s\S]*\['get', 'lineColor'\][\s\S]*\['get', 'lineWidth'\]/u,
  );
  assert.doesNotMatch(
    editor,
    /id: 'geometry-editor-selected-line'[\s\S]{0,500}'line-width': 5/u,
  );
  assert.match(
    editor,
    /form\.elements\.lineTypeId[\s\S]*addEventListener\('change'[\s\S]*captureCurrentDraft/u,
  );
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
    /geometry-editor-draw-fill[\s\S]*\['!=', \['get', 'mode'\], 'cut'\]/u,
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


test('cut polygon uses the same blade styling as line split and has no geometry fill', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /geometry-editor-cut-blade[\s\S]*\['==', \['get', 'mode'\], 'cut'\][\s\S]*'line-color': '#ff5d67'[\s\S]*'line-width': 3[\s\S]*'line-dasharray': \[1\.5, 1\]/u,
  );
  assert.match(
    editor,
    /geometry-editor-cut-point[\s\S]*'circle-color': '#ff5d67'/u,
  );
  assert.match(
    editor,
    /geometry-editor-draw-line[\s\S]*\['literal', \['split', 'cut'\]\]/u,
  );
  assert.match(
    editor,
    /geometry-editor-draw-fill[\s\S]*\['!=', \['get', 'mode'\], 'cut'\]/u,
  );
});


test('geometry editor exposes local-preview polygon cutter and line-blade split operations', async () => {
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
    /id="geometry-cut-area"[\s\S]*Вырезать область \/ отверстие/u,
  );
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
    /cutTarget\([\s\S]*cutter\.geometry/u,
  );
  assert.match(
    editor,
    /\/topology\/split-preview/u,
  );
  assert.match(
    editor,
    /sourceGeometry[\s\S]*blade/u,
  );
  assert.match(
    editor,
    /drawing\.mode === 'split'/u,
  );
  assert.match(
    editor,
    /После второй точки разделение выполнится автоматически/u,
  );
  assert.match(
    editor,
    /geometry-editor-split-blade[\s\S]*line-dasharray/u,
  );
  assert.match(
    editor,
    /state\.drawing[\s\S]*\.mode ===[\s\S]*'split'[\s\S]*\.length ===[\s\S]*2[\s\S]*finishDrawing\(\)/u,
  );
  assert.match(
    editor,
    /finishDrawButton\.hidden =[\s\S]*'point'[\s\S]*'split'[\s\S]*\.includes\([\s\S]*drawing\?\.mode/u,
  );
  assert.match(
    editor,
    /topologyTargetReady\(\[[\s\S]*'line'[\s\S]*'polygon'/u,
  );
  assert.match(
    editor,
    /Геометрия разделена только в локальных черновиках/u,
  );
  assert.doesNotMatch(
    editor,
    /\/geometries\/\$\{encodeURIComponent\(target\.id\)\}\/split/u,
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
    /class="geometry-editor-map-controls"[\s\S]*id="geometry-topology-actions"[\s\S]*aria-label="Геометрические операции"/u,
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
    'geometry-coordinate-clear',
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
    /function refreshCoordinateValidation\(\)[\s\S]*coordinateApply\.disabled/u,
  );
  assert.match(
    editor,
    /normalizeCoordinateInput\([\s\S]*setCustomValidity/u,
  );
  assert.match(
    editor,
    /coordinateClear\.addEventListener\([\s\S]*replaceChildren/u,
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


test('geometry editor keeps creation and edit activation explicit and selects local geometries from the map', async () => {
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
    /function renderCreateControls\(\)[\s\S]*state\.editing[\s\S]*state\.drawing/u,
  );
  assert.match(
    editor,
    /Завершите текущее редактирование или рисование/u,
  );
  assert.match(
    editor,
    /isLocalGeometryId\([\s\S]*rawId[\s\S]*void selectGeometry/u,
  );
  assert.match(
    editor,
    /function adoptGeometryDetail[\s\S]*state\.editing = false;[\s\S]*state\.editLease = null;/u,
  );
  assert.match(
    editor,
    /state\.editing &&[\s\S]*String\(state\.current\?\.id\)[\s\S]*String\(id\)[\s\S]*return;/u,
  );

  assert.match(
    page,
    /class="geometry-editor-map-controls"/u,
  );
  assert.match(
    page,
    /id="geometry-coordinate-open"[\s\S]*id="geometry-undo"[\s\S]*id="geometry-redo"[\s\S]*id="geometry-topology-actions"/u,
  );
  assert.doesNotMatch(
    page,
    /class="geometry-editor-topology-actions"/u,
  );
  assert.match(
    styles,
    /\.geometry-editor-map-controls\s*\{[\s\S]*position: absolute;[\s\S]*top: 3\.55rem;[\s\S]*left: \.55rem;/u,
  );
});


test('external local draft refresh does not silently re-enter edit mode', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  const start =
    editor.indexOf(
      'function syncSelectedDraftFromStorage()',
    );
  const end =
    editor.indexOf(
      'function scheduleGeometryServerSync',
      start,
    );
  const source =
    editor.slice(
      start,
      end,
    );

  assert.match(
    source,
    /isLocalGeometryId\(state\.selectedId\)[\s\S]*state\.draft = clone\(item\.geometry\)/u,
  );
  assert.doesNotMatch(
    source,
    /state\.editing = true;/u,
  );
});


test('local geometry selection stays passive and double click finishes explicit editing', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /function adoptLocalGeometry[\s\S]*state\.editing = false;/u,
  );
  assert.match(
    editor,
    /beginEditButton\.hidden =[\s\S]*!item\?\.id[\s\S]*state\.editing/u,
  );
  assert.match(
    editor,
    /async function beginEditing\(\)[\s\S]*isLocalGeometryId\([\s\S]*item\.id[\s\S]*state\.editing =[\s\S]*true[\s\S]*Редактирование локальной геометрии начато/u,
  );
  assert.match(
    editor,
    /async function saveCurrent\(\)[\s\S]*const localItem =[\s\S]*state\.editing = false;[\s\S]*Активное редактирование завершено/u,
  );
  assert.match(
    editor,
    /map\.on\([\s\S]*'dblclick'[\s\S]*const finishEditing =[\s\S]*state\.editing[\s\S]*void saveCurrent\(\)/u,
  );
  assert.match(
    editor,
    /двойной клик — закончить/u,
  );
});


test('geometry drawing can finish naturally with a map double click', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /map\.on\([\s\S]*'dblclick'[\s\S]*'line'[\s\S]*'polygon'[\s\S]*'cut'/u,
  );
  assert.match(
    editor,
    /repeatedClickDistance[\s\S]*<=\s*8[\s\S]*coordinates\.pop\(\)/u,
  );
  assert.match(
    editor,
    /drawing\.mode ===[\s\S]*'line'[\s\S]*\? 2[\s\S]*: 3/u,
  );
  assert.match(
    editor,
    /двойной клик — завершить/u,
  );
  assert.match(
    editor,
    /двойной клик — вырезать/u,
  );
});


test('union preview never persists directly and supports local plus server drafts', async () => {
  const editor =
    await read(
      'admin/geometry-editor.js',
    );

  assert.match(
    editor,
    /items\.find\([\s\S]*!isLocalGeometryId/u,
  );
  assert.match(
    editor,
    /isLocalGeometryId\([\s\S]*drafts\.remove/u,
  );
  assert.match(
    editor,
    /Геометрии объединены только локально/u,
  );
  assert.doesNotMatch(
    editor,
    /\/api\/admin\/geometry-editor\/merge/u,
  );
});


test('geometry editor shows explicit editing notice and edits zoom/date visibility metadata locally', async () => {
  const [
    html,
    editor,
    styles,
  ] =
    await Promise.all([
      read('admin/index.html'),
      read('admin/geometry-editor.js'),
      read('admin/geometry-editor.css'),
    ]);

  assert.match(
    html,
    /id="geometry-editing-notice"/u,
  );
  assert.match(
    html,
    /name="minZoom"[\s\S]*name="maxZoom"[\s\S]*name="validFrom"[\s\S]*name="validTo"/u,
  );
  assert.match(
    editor,
    /editingNotice\.hidden =[\s\S]*!state\.editing/u,
  );
  assert.match(
    editor,
    /Вы редактируете/u,
  );
  assert.match(
    editor,
    /minZoom:[\s\S]*form\.elements\.minZoom/u,
  );
  assert.match(
    editor,
    /validFrom:[\s\S]*form\.elements\.validFrom/u,
  );
  assert.match(
    editor,
    /function syncDisplayWindowValidity\([\s\S]*minZoom > maxZoom[\s\S]*validFrom > validTo/u,
  );
  assert.match(
    styles,
    /\.geometry-editor-editing-notice/u,
  );
  assert.match(
    styles,
    /\.geometry-display-window-grid/u,
  );
});


test('geometry editor discussion uses compact messenger UI with unread realtime state', async () => {
  const html =
    await read(
      'admin/index.html',
    );
  const script =
    await read(
      'admin/geometry-editor.js',
    );
  const styles =
    await read(
      'admin/geometry-editor.css',
    );

  assert.match(
    html,
    /id="geometry-discussion-open"[\s\S]*aria-label="Открыть обсуждение геометрии"/u,
  );
  assert.match(
    html,
    /geometry-discussion-envelope[\s\S]*viewBox="0 0 20 16"[\s\S]*M2\.5 3\.5 10 9l7\.5-5\.5/u,
  );
  assert.match(
    html,
    /id="geometry-discussion-unread"[\s\S]*hidden/u,
  );
  assert.match(
    html,
    /id="geometry-discussion"/u,
  );
  assert.match(
    html,
    /id="geometry-discussion-messages"/u,
  );
  assert.match(
    html,
    /id="geometry-discussion-form"/u,
  );
  assert.match(
    html,
    /id="geometry-discussion-input"[\s\S]*rows="1"[\s\S]*placeholder="Сообщение…"/u,
  );
  assert.match(
    html,
    /geometry-discussion-send[\s\S]*aria-label="Отправить сообщение"[\s\S]*><\/button>/u,
  );

  assert.match(
    script,
    /function renderEditLockIdentity\(/u,
  );
  assert.match(
    script,
    /'geometry-discussions'/u,
  );
  assert.match(
    script,
    /async function loadDiscussion\(/u,
  );
  assert.match(
    script,
    /async function sendDiscussionMessage\(/u,
  );
  assert.match(
    script,
    /discussionUnreadByGeometry:\s*new Map\(\)/u,
  );
  assert.match(
    script,
    /function incrementDiscussionUnread\(/u,
  );
  assert.match(
    script,
    /function markDiscussionRead\(/u,
  );
  assert.match(
    script,
    /async function loadDiscussionUnread\([\s\S]*\/api\/admin\/geometry-editor\/discussions\/unread/u,
  );
  assert.match(
    script,
    /async function persistDiscussionRead\([\s\S]*\/discussion\/read/u,
  );
  assert.match(
    script,
    /function markOwnMessagesReadThrough\(/u,
  );
  assert.match(
    script,
    /readByOthersCount[\s\S]*✓✓ Прочитано[\s\S]*✓ Доставлено/u,
  );
  assert.match(
    script,
    /discussionIsOpenFor\([\s\S]*appendDiscussionMessage[\s\S]*incrementDiscussionUnread/u,
  );
  assert.match(
    script,
    /event\.key === 'Enter'[\s\S]*!event\.shiftKey[\s\S]*requestSubmit\(\)/u,
  );
  assert.match(
    script,
    /function resizeDiscussionInput\(/u,
  );

  assert.match(
    styles,
    /\.geometry-discussion \{[\s\S]*position: fixed/u,
  );
  assert.match(
    styles,
    /\.geometry-discussion-open \{[\s\S]*width: 2\.35rem/u,
  );
  assert.match(
    styles,
    /\.geometry-discussion-envelope \{[\s\S]*stroke: currentColor/u,
  );
  assert.match(
    styles,
    /\.geometry-discussion-unread \{/u,
  );
  assert.match(
    styles,
    /\.geometry-discussion-message\.is-own[\s\S]*align-self: flex-end/u,
  );
  assert.match(
    styles,
    /\.geometry-discussion-message\.is-incoming/u,
  );
  assert.match(
    styles,
    /\.geometry-discussion-form \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 2\.35rem/u,
  );
  assert.match(
    styles,
    /\.geometry-discussion-send::before[\s\S]*border-left: 10px solid currentColor/u,
  );
  assert.match(
    styles,
    /\.geometry-discussion \{[\s\S]*min-width: 20rem[\s\S]*min-height: 16rem[\s\S]*resize: both/u,
  );
  assert.match(
    styles,
    /\.geometry-discussion-open\.has-unread \{[\s\S]*background: #52d7c6/u,
  );
  assert.match(
    styles,
    /\.geometry-discussion-receipt \{/u,
  );
  assert.match(
    styles,
    /@media \(max-width: 650px\)[\s\S]*\.geometry-discussion \{[\s\S]*resize: none/u,
  );
  assert.doesNotMatch(
    html,
    /class="visually-hidden"[\s\S]*geometry-discussion/u,
  );
  assert.match(
    styles,
    /\.geometry-edit-actor-avatar/u,
  );
});
