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
});
