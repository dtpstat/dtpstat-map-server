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

test('admin layout schema owns dynamic sections and nested interface tab order', async () => {
  const [
    shell,
    schema,
    engine,
    styles,
  ] =
    await Promise.all([
      read(
        'admin/admin-shell.js',
      ),
      read(
        'admin/admin-layout-schema.js',
      ),
      read(
        'admin/admin-layout.js',
      ),
      read(
        'admin/admin-layout.css',
      ),
    ]);

  assert.match(
    shell,
    /ensureAdminSections\([\s\S]*adminDynamicSections/u,
  );
  assert.match(
    shell,
    /ensureAdminTabPanels\([\s\S]*adminInterfaceTabs/u,
  );
  assert.match(
    shell,
    /setupAdminTabs\([\s\S]*adminInterfaceTabs/u,
  );
  assert.doesNotMatch(
    shell,
    /function setupInterfaceTabs/u,
  );

  for (
    const id of [
      'project',
      'map',
      'report',
      'line-types',
      'point-types',
      'project-transfer',
    ]
  ) {
    assert.match(
      schema,
      new RegExp(
        `id:\\s*['"]${id}['"]`,
        'u',
      ),
    );
  }

  assert.match(
    schema,
    /permission:[\s\S]*'superuser'/u,
  );
  assert.match(
    schema,
    /openEvent:[\s\S]*'dtpstat:line-types-changed'/u,
  );
  assert.match(
    schema,
    /openEvent:[\s\S]*'dtpstat:point-types-changed'/u,
  );
  for (
    const hostId of [
      'project-settings-editor-host',
      'map-settings-editor-host',
      'report-config-editor-host',
      'line-types-editor-host',
      'point-types-editor-host',
    ]
  ) {
    assert.match(
      schema,
      new RegExp(
        `hostId:[\\s\\S]*['"]${hostId}['"]`,
        'u',
      ),
    );
  }
  assert.match(
    schema,
    /id:\s*'project'[\s\S]*elementId:[\s\S]*'operation-project-settings'/u,
  );
  assert.match(
    schema,
    /id:\s*'map'[\s\S]*elementId:[\s\S]*'operation-map-settings'/u,
  );
  assert.match(
    schema,
    /id:\s*'report'[\s\S]*panelClass:[\s\S]*'report-interface-panel'/u,
  );
  assert.match(
    schema,
    /id:\s*'messages-list'[\s\S]*wide:\s*4/u,
  );
  assert.match(
    schema,
    /id:\s*'messages-thread'[\s\S]*wide:\s*8/u,
  );
  assert.match(
    engine,
    /definition\.elementId[\s\S]*block\.id[\s\S]*definition\.elementId/u,
  );
  assert.match(
    engine,
    /appendClassNames\([\s\S]*panel,[\s\S]*definition\.panelClass/u,
  );

  assert.match(
    engine,
    /export function ensureAdminTabPanels/u,
  );
  assert.match(
    engine,
    /definition\.blocks\?\.length/u,
  );
  assert.match(
    engine,
    /admin-layout-tab-grid/u,
  );
  assert.match(
    engine,
    /createInterfaceBlock/u,
  );
  assert.match(
    engine,
    /export function setupAdminTabs/u,
  );
  assert.match(
    engine,
    /tabsHost\.append\([\s\S]*tab/u,
  );
  assert.match(
    engine,
    /panelsHost\.append\([\s\S]*panel/u,
  );
  assert.match(
    engine,
    /definition\?\.openEvent|definition\.openEvent/u,
  );

  assert.match(
    styles,
    /container-type:\s*inline-size/u,
  );
  assert.match(
    styles,
    /--admin-block-span/u,
  );
  assert.match(
    styles,
    /@container admin-layout-grid \(max-width: 63\.999rem\)/u,
  );
  assert.match(
    styles,
    /grid-column:\s*1 \/ -1/u,
  );
  assert.doesNotMatch(
    styles,
    /@media \(max-width:\s*1050px\)[\s\S]*admin-layout-grid/u,
  );
});
