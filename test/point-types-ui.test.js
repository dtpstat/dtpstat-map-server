import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';

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

test('interface settings expose point type CRUD and safe icon controls', async () => {
  const [
    html,
    shell,
    schema,
    editor,
    styles,
  ] =
    await Promise.all([
      read('admin/index.html'),
      read('admin/admin-shell.js'),
      read('admin/admin-layout-schema.js'),
      read('admin/point-types-editor.js'),
      read('admin/point-types.css'),
    ]);

  assert.doesNotMatch(
    html,
    /data-interface-tab="point-types"/u,
  );
  assert.doesNotMatch(
    html,
    /data-interface-panel="point-types"/u,
  );
  assert.doesNotMatch(
    html,
    /id="point-types-editor-host"/u,
  );
  assert.match(
    schema,
    /id:\s*'point-types'[\s\S]*hostId:[\s\S]*'point-types-editor-host'/u,
  );
  assert.match(
    html,
    /href="\/admin\/point-types\.css"/u,
  );

  assert.match(
    shell,
    /await import\('\.\/point-types-editor\.js'\)/u,
  );
  assert.match(
    shell,
    /adminInterfaceTabs/u,
  );
  assert.match(
    schema,
    /id:\s*'point-types'[\s\S]*openEvent:\s*'dtpstat:point-types-changed'/u,
  );

  assert.match(
    editor,
    /\/api\/admin\/point-types/u,
  );
  assert.match(
    editor,
    /method:\s*'PATCH'/u,
  );
  assert.match(
    editor,
    /method:\s*'DELETE'/u,
  );
  assert.match(
    editor,
    /\/icon/u,
  );
  assert.match(
    editor,
    /method:\s*'PUT'/u,
  );
  assert.match(
    editor,
    /MAX_ICON_BYTES/u,
  );
  assert.match(
    editor,
    /application\/octet-stream/u,
  );
  assert.match(
    editor,
    /geometryCount/u,
  );
  assert.match(
    editor,
    /displayWidth/u,
  );
  assert.match(
    editor,
    /displayHeight/u,
  );
  assert.match(
    editor,
    /anchorX/u,
  );
  assert.match(
    editor,
    /anchorY/u,
  );
  assert.match(
    editor,
    /name=['"]minZoom['"]/u,
  );
  assert.match(
    editor,
    /name=['"]maxZoom['"]/u,
  );
  assert.match(
    editor,
    /Zoom от/u,
  );
  assert.match(
    editor,
    /Zoom до/u,
  );
  assert.match(
    editor,
    /minZoom:[\s\S]*=== ''[\s\S]*null/u,
  );
  assert.match(
    editor,
    /maxZoom:[\s\S]*=== ''[\s\S]*null/u,
  );
  assert.match(
    editor,
    /const refreshPreview =[\s\S]*anchorX\.value[\s\S]*anchorY\.value[\s\S]*preview\(\{[\s\S]*anchorX:[\s\S]*nextAnchorX[\s\S]*anchorY:[\s\S]*nextAnchorY/u,
  );
  assert.match(
    editor,
    /anchorX\.addEventListener\([\s\S]*'input'[\s\S]*refreshPreview/u,
  );
  assert.match(
    editor,
    /anchorY\.addEventListener\([\s\S]*'input'[\s\S]*refreshPreview/u,
  );
  assert.match(
    editor,
    /width\.addEventListener\([\s\S]*syncAnchorBounds[\s\S]*height\.addEventListener/u,
  );
  assert.match(
    editor,
    /trackDirtyForm/u,
  );
  assert.match(
    editor,
    /adminConfirm/u,
  );
  assert.doesNotMatch(
    editor,
    /Загрузить иконку/u,
  );
  assert.match(
    editor,
    /row\.addEventListener\([\s\S]*'submit'[\s\S]*const file =[\s\S]*icon\.files/u,
  );
  assert.match(
    editor,
    /method:[\s\S]*'PATCH'[\s\S]*if \(file\)[\s\S]*method:[\s\S]*'PUT'/u,
  );
  assert.match(
    editor,
    /Тип точки и иконка сохранены/u,
  );
  assert.match(
    editor,
    /icon\.value =[\s\S]*''[\s\S]*dtpstat:point-types-changed/u,
  );

  assert.match(
    styles,
    /\.point-type-preview-anchor/u,
  );
  assert.match(
    styles,
    /\.point-type-settings-grid/u,
  );
  assert.match(
    styles,
    /@container admin-layout-block \(max-width: 68rem\)/u,
  );
  assert.match(
    styles,
    /@container admin-layout-block \(max-width: 48rem\)/u,
  );
  assert.match(
    styles,
    /@container admin-layout-block \(max-width: 30rem\)/u,
  );
  assert.doesNotMatch(
    styles,
    /@media \(max-width:\s*(1100|760|480)px\)/u,
  );
});

test('geometry editor assigns point types through the existing local draft flow', async () => {
  const [
    html,
    editor,
    drafts,
    icons,
  ] =
    await Promise.all([
      read('admin/index.html'),
      read('admin/geometry-editor.js'),
      read('admin/geometry-draft.js'),
      read('public/js/point-type-map-icons.js'),
    ]);

  assert.match(
    html,
    /id="geometry-point-fields"/u,
  );
  assert.match(
    html,
    /name="pointTypeId"/u,
  );

  assert.match(
    editor,
    /pointTypes: \[\]/u,
  );
  assert.match(
    editor,
    /api\('\/api\/point-types'\)/u,
  );
  assert.match(
    editor,
    /family === 'point'[\s\S]*pointTypeId:/u,
  );
  assert.match(
    editor,
    /form\.elements\.pointTypeId/u,
  );
  assert.match(
    editor,
    /pointFields\.hidden = family !== 'point'/u,
  );
  assert.match(
    editor,
    /pointTypeName/u,
  );
  assert.match(
    editor,
    /dtpstat:point-types-changed/u,
  );
  assert.match(
    editor,
    /geometry-editor-point-icons/u,
  );
  assert.match(
    editor,
    /geometry-editor-selected-point-icon/u,
  );
  assert.match(
    editor,
    /syncPointTypeImages/u,
  );
  assert.match(
    editor,
    /state\.geometryDrag \|\|[\s\S]*state\.coordinateWindowOpen/u,
  );
  assert.match(
    editor,
    /previous[\s\S]*replaceChildren[\s\S]*option\.value ===[\s\S]*previous/u,
  );

  assert.match(
    drafts,
    /'pointTypeId'/u,
  );

  assert.match(
    icons,
    /export function pointTypeImageId/u,
  );
  assert.match(
    icons,
    /export function pointTypeIconOffset/u,
  );
  assert.match(
    icons,
    /export async function rasterizePointTypeIcon/u,
  );
  assert.match(
    icons,
    /map\.addImage/u,
  );
});
