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

  assert.doesNotMatch(
    editor,
    /geometry-import\/pending/u,
  );
  assert.doesNotMatch(
    editor,
    /api\('\/api\/admin\/geometry-editor\/merge/u,
  );
  assert.doesNotMatch(
    editor,
    /\/cut',?\s*\{/u,
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
