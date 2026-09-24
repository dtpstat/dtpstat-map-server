import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFile(path.join(root, relativePath), 'utf8');

test('V035 introduces a dedicated OSM editor role without geometry permissions', async () => {
  const sql = await read('db/migrations/V035__osm_editor_role.sql');

  assert.match(sql, /ADD COLUMN IF NOT EXISTS CAN_EDIT_OSM BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.match(sql, /WHERE CAN_MANAGE_DATA[\s\S]*OR IS_SUPERUSER[\s\S]*OR IS_BOOTSTRAP/i);
  assert.doesNotMatch(sql, /CAN_EDIT_GEOMETR/i);
});

test('OSM editor role crosses persistence service authorization and UI boundaries', async () => {
  const [repository, securityPolicy, securityService, authorizationPolicy, auth, router, shell, editor] = await Promise.all([
    read('src/db/admin-user-repository.js'),
    read('src/modules/security/policy.js'),
    read('src/modules/security/account-service.js'),
    read('src/modules/security/authorization-policy.js'),
    read('src/http/admin-auth.js'),
    read('src/routes/osm-boundaries-api.js'),
    read('admin/admin-shell.js'),
    read('admin/security-editor-v2.js'),
  ]);

  assert.match(repository, /can_edit_osm AS "canEditOsm"/);
  assert.match(repository, /can_edit_osm = \$6/);
  assert.match(securityPolicy, /canEditOsm: Boolean\(user\.canEditOsm\)/);
  assert.match(securityService, /'canEditOsm'/);
  assert.match(authorizationPolicy, /permission === 'osm-editor'/);
  assert.match(auth, /requireOsmEditor:\s*middleware\('osm-editor'\)/);
  assert.match(router, /adminAuth\.requireOsmEditor/);
  assert.doesNotMatch(router, /adminAuth\.requireData/);
  assert.match(shell, /'osm-objects': !mustChangePassword && canEditOsm\(user\)/);
  assert.match(editor, /roleCheckbox\('canEditOsm', 'Объекты OSM'/);
  assert.match(editor, /canEditOsm: form\.elements\.canEditOsm\.checked/);
});
